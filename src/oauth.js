import crypto from "node:crypto";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidClientError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";

const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function renderLoginPage({ error, clientId, clientName, redirectUri, state, codeChallenge, scope, resource }) {
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
  <p>This app is requesting access to your mailbox. Enter your access passphrase to allow it.</p>
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

/**
 * A minimal, single-user, in-memory OAuth 2.1 provider for the MCP SDK's
 * auth router. Suitable for a personal server with one owner. State is
 * lost on process restart, which just means clients re-authorize.
 */
export function createOAuthProvider({ authPassword }) {
  if (!authPassword) {
    throw new Error("authPassword is required to create the OAuth provider.");
  }

  const clients = new Map(); // client_id -> OAuthClientInformationFull
  const authCodes = new Map(); // code -> { clientId, codeChallenge, redirectUri, scopes, resource, expiresAt }
  const accessTokens = new Map(); // token -> { clientId, scopes, resource, expiresAt(seconds) }
  const refreshTokens = new Map(); // token -> { clientId, scopes, resource }

  function issueTokens(clientId, scopes, resource, { includeRefresh = true } = {}) {
    const access_token = randomToken();
    const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    accessTokens.set(access_token, { clientId, scopes, resource, expiresAt });
    const tokens = {
      access_token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
    };
    if (includeRefresh) {
      const refresh_token = randomToken();
      refreshTokens.set(refresh_token, { clientId, scopes, resource });
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
      // client_secret at the /token step, even when one was issued here.
      // The SDK's authenticateClient middleware only requires a secret
      // when the stored client record has one, so stripping it at
      // registration time is what actually fixes the token exchange.
      const { client_secret, client_secret_expires_at, ...publicClientInfo } = clientInfo;
      clients.set(publicClientInfo.client_id, publicClientInfo);
      return publicClientInfo;
    },
  };

  const provider = {
    clientsStore,

    async authorize(client, params, res) {
      const html = renderLoginPage({
        error: null,
        clientId: client.client_id,
        clientName: client.client_name || client.client_id,
        redirectUri: params.redirectUri,
        state: params.state || "",
        codeChallenge: params.codeChallenge,
        scope: (params.scopes || []).join(" "),
        resource: params.resource ? params.resource.href : "",
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
      return issueTokens(client.client_id, scopes || record.scopes, resource || record.resource, {
        includeRefresh: false,
      });
    },

    async verifyAccessToken(token) {
      const record = accessTokens.get(token);
      if (!record || (record.expiresAt && record.expiresAt < Math.floor(Date.now() / 1000))) {
        throw new InvalidTokenError("Invalid or expired access token");
      }
      return {
        token,
        clientId: record.clientId,
        scopes: record.scopes,
        expiresAt: record.expiresAt,
        resource: record.resource,
      };
    },

    async revokeToken(_client, request) {
      accessTokens.delete(request.token);
      refreshTokens.delete(request.token);
    },
  };

  /**
   * Handles the POST from the login form rendered by `authorize`.
   * Returns either { ok: true, redirect } or { ok: false, html } (a
   * re-rendered form with an error message, for the caller to send back).
   */
  function approveLogin({ password, client_id, redirect_uri, state, code_challenge, scope, resource }) {
    const client = clients.get(client_id);
    if (!client) throw new InvalidClientError("Unknown client");

    if (password !== authPassword) {
      const html = renderLoginPage({
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
      resource: resource ? new URL(resource) : undefined,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const redirect = new URL(redirect_uri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    return { ok: true, redirect: redirect.href };
  }

  return { provider, approveLogin };
}
