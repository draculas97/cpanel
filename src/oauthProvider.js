import crypto from "node:crypto";
import { InvalidGrantError, InvalidTokenError, InvalidClientError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { query, verifyPassphrase } from "./db.js";
import { getTenantBySlug } from "./tenants.js";

const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// A resource URL identifies which tenant an authorization is for — Claude's
// MCP connector is configured with `https://host/t/<slug>/mcp` as its
// server URL and, per the MCP authorization spec, sends that same URL back
// as the `resource` parameter on /authorize and /token requests.
function tenantSlugFromResource(resourceUrl) {
  if (!resourceUrl) return null;
  const match = resourceUrl.pathname.match(/^\/t\/([^/]+)\/mcp\/?$/);
  return match ? match[1] : null;
}

function renderLoginPage({ tenantName, error, clientId, clientName, redirectUri, state, codeChallenge, scope, resource }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Authorize access</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e6edf3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  form{background:#151b23;padding:32px;border-radius:12px;width:320px;max-width:90vw;box-shadow:0 8px 24px rgba(0,0,0,.4)}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:13px;color:#9aa7b2;margin:0 0 20px}
  input[type=password]{width:100%;padding:10px;border-radius:6px;border:1px solid #2d3742;background:#0b0f14;color:#e6edf3;box-sizing:border-box;font-size:14px}
  button{width:100%;margin-top:16px;padding:10px;border-radius:6px;border:none;background:#2f81f7;color:white;font-size:14px;cursor:pointer}
  .err{color:#f85149;font-size:13px;margin-top:12px}
</style></head>
<body>
<form method="POST" action="/login">
  <h1>Authorize "${escapeHtml(clientName)}"</h1>
  <p>This app is requesting access to the <strong>${escapeHtml(tenantName)}</strong> mailbox. Enter its access passphrase to allow it.</p>
  <input type="password" name="password" placeholder="Access passphrase" autofocus required />
  <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
  <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
  <input type="hidden" name="state" value="${escapeHtml(state)}" />
  <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
  <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
  <input type="hidden" name="resource" value="${escapeHtml(resource)}" />
  <button type="submit">Authorize</button>
  ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
</form>
</body></html>`;
}

function renderResourceErrorPage(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cannot authorize</title></head>
<body style="font-family:system-ui,sans-serif;background:#0b0f14;color:#e6edf3;padding:40px;">
<h1>Cannot authorize</h1><p>${escapeHtml(message)}</p></body></html>`;
}

/**
 * A single OAuth 2.1 authorization server shared by every tenant, backed by
 * Postgres (clients + access/refresh tokens survive a restart; in-flight
 * authorization codes are in-memory only and expire in 5 minutes — a
 * restart mid-authorize just means clicking Authorize again). Call once at
 * boot; it hydrates existing clients/tokens from the database.
 */
export async function createOAuthProvider() {
  const clients = new Map(); // client_id -> client info
  const accessTokens = new Map(); // token -> { clientId, scopes, resource, expiresAt }
  const refreshTokens = new Map(); // token -> { clientId, scopes, resource }
  const authCodes = new Map(); // code -> { clientId, codeChallenge, redirectUri, scopes, resource, expiresAt } (in-memory only)

  const { rows: clientRows } = await query("SELECT client_id, client_info FROM oauth_clients");
  for (const row of clientRows) clients.set(row.client_id, row.client_info);

  const { rows: tokenRows } = await query("SELECT token, kind, client_id, scopes, resource, expires_at FROM oauth_tokens");
  for (const row of tokenRows) {
    const record = {
      clientId: row.client_id,
      scopes: row.scopes || [],
      resource: row.resource ? new URL(row.resource) : undefined,
      expiresAt: row.expires_at != null ? Number(row.expires_at) : undefined,
    };
    if (row.kind === "access") accessTokens.set(row.token, record);
    else refreshTokens.set(row.token, record);
  }

  function persistToken(token, kind, record) {
    query(
      `INSERT INTO oauth_tokens (token, kind, client_id, scopes, resource, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token) DO NOTHING`,
      [token, kind, record.clientId, record.scopes, record.resource ? record.resource.href : null, record.expiresAt ?? null]
    ).catch((err) => console.error(`Failed to persist ${kind} token:`, err));
  }

  function issueTokens(clientId, scopes, resource, { includeRefresh = true } = {}) {
    const access_token = randomToken();
    const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    const accessRecord = { clientId, scopes, resource, expiresAt };
    accessTokens.set(access_token, accessRecord);
    persistToken(access_token, "access", accessRecord);

    const tokens = {
      access_token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
    };
    if (includeRefresh) {
      const refresh_token = randomToken();
      const refreshRecord = { clientId, scopes, resource };
      refreshTokens.set(refresh_token, refreshRecord);
      persistToken(refresh_token, "refresh", refreshRecord);
      tokens.refresh_token = refresh_token;
    }
    return tokens;
  }

  const clientsStore = {
    getClient(clientId) {
      return clients.get(clientId);
    },
    registerClient(clientInfo) {
      // Force every dynamically-registered client to be treated as public
      // (PKCE-only, no client_secret). Claude's MCP connector does the
      // authorization_code + PKCE dance but never sends back a
      // client_secret at the /token step, even when one was issued here —
      // stripping it at registration time is what makes the token exchange
      // succeed.
      const { client_secret, client_secret_expires_at, ...publicClientInfo } = clientInfo;
      clients.set(publicClientInfo.client_id, publicClientInfo);
      query(
        `INSERT INTO oauth_clients (client_id, client_info) VALUES ($1,$2)
         ON CONFLICT (client_id) DO UPDATE SET client_info = EXCLUDED.client_info`,
        [publicClientInfo.client_id, JSON.stringify(publicClientInfo)]
      ).catch((err) => console.error("Failed to persist OAuth client:", err));
      return publicClientInfo;
    },
  };

  const provider = {
    clientsStore,

    async authorize(client, params, res) {
      const slug = tenantSlugFromResource(params.resource);
      if (!slug) {
        res
          .status(400)
          .type("html")
          .send(
            renderResourceErrorPage(
              "This connector didn't specify which mailbox (resource) it wants to access. Reconnect from Claude using this tenant's full connector URL (https://.../t/<slug>/mcp)."
            )
          );
        return;
      }
      const tenant = await getTenantBySlug(slug);
      if (!tenant) {
        res.status(404).type("html").send(renderResourceErrorPage(`Unknown tenant "${slug}".`));
        return;
      }

      const html = renderLoginPage({
        tenantName: tenant.displayName || tenant.slug,
        error: null,
        clientId: client.client_id,
        clientName: client.client_name || client.client_id,
        redirectUri: params.redirectUri,
        state: params.state || "",
        codeChallenge: params.codeChallenge,
        scope: (params.scopes || []).join(" "),
        resource: params.resource.href,
      });
      res.type("html").send(html);
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      const record = authCodes.get(authorizationCode);
      if (!record || record.clientId !== client.client_id || record.expiresAt < Date.now()) {
        throw new InvalidGrantError("Invalid or expired authorization code");
      }
      return record.codeChallenge;
    },

    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
      const record = authCodes.get(authorizationCode);
      if (!record || record.clientId !== client.client_id || record.expiresAt < Date.now()) {
        throw new InvalidGrantError("Invalid or expired authorization code");
      }
      authCodes.delete(authorizationCode); // single use
      return issueTokens(client.client_id, record.scopes, resource || record.resource);
    },

    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      const record = refreshTokens.get(refreshToken);
      if (!record || record.clientId !== client.client_id) {
        throw new InvalidGrantError("Invalid refresh token");
      }
      return issueTokens(client.client_id, scopes || record.scopes, resource || record.resource, { includeRefresh: false });
    },

    async verifyAccessToken(token) {
      const record = accessTokens.get(token);
      if (!record || (record.expiresAt && record.expiresAt < Math.floor(Date.now() / 1000))) {
        throw new InvalidTokenError("Invalid or expired access token");
      }
      return { token, clientId: record.clientId, scopes: record.scopes, expiresAt: record.expiresAt, resource: record.resource };
    },

    async revokeToken(_client, request) {
      accessTokens.delete(request.token);
      refreshTokens.delete(request.token);
      query("DELETE FROM oauth_tokens WHERE token = $1", [request.token]).catch((err) =>
        console.error("Failed to delete revoked token:", err)
      );
    },
  };

  /**
   * Handles the POST from the login form rendered by `authorize`. Verifies
   * the passphrase against the *tenant identified by the `resource` field*
   * (not a single global passphrase) — this is what makes one shared
   * authorization server safe for many tenants: each still only accepts
   * its own mailbox's passphrase. Returns either { ok: true, redirect } or
   * { ok: false, html } (a re-rendered form with an error, to send back).
   */
  async function approveLogin({ password, client_id, redirect_uri, state, code_challenge, scope, resource }) {
    const client = clients.get(client_id);
    if (!client) throw new InvalidClientError("Unknown client");

    const resourceUrl = resource ? new URL(resource) : undefined;
    const slug = tenantSlugFromResource(resourceUrl);
    const tenant = slug ? await getTenantBySlug(slug) : null;

    if (!tenant || !verifyPassphrase(password, tenant.authPassphraseHash)) {
      const html = renderLoginPage({
        tenantName: tenant?.displayName || slug || "this mailbox",
        error: "Incorrect passphrase. Try again.",
        clientId: client_id,
        clientName: client.client_name || client_id,
        redirectUri: redirect_uri,
        state,
        codeChallenge: code_challenge,
        scope,
        resource,
      });
      return { ok: false, html };
    }

    const code = randomToken(24);
    authCodes.set(code, {
      clientId: client_id,
      codeChallenge: code_challenge,
      redirectUri: redirect_uri,
      scopes: scope ? scope.split(" ").filter(Boolean) : [],
      resource: resourceUrl,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const redirect = new URL(redirect_uri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    return { ok: true, redirect: redirect.href };
  }

  return { provider, approveLogin };
}
