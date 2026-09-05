import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

let pool = null;

// A single shared connection pool for the whole process. Every tenant's
// data lives in the same Postgres database, partitioned by tenant_id /
// tenant-scoped foreign keys — there is no per-tenant database.
export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "Missing DATABASE_URL — the multi-tenant backend requires a Postgres database " +
          "(e.g. Render's own Postgres, or Supabase's free tier). Set DATABASE_URL to its connection string."
      );
    }
    pool = new Pool({
      connectionString,
      // Most managed Postgres providers (Render, Supabase) terminate TLS
      // with a certificate that isn't in Node's default trust store for
      // this kind of pooled connection; rejectUnauthorized:false keeps the
      // connection encrypted without failing on that. Set DATABASE_SSL=false
      // to disable TLS entirely (e.g. a local/self-hosted Postgres).
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT,
  auth_passphrase_hash TEXT NOT NULL,

  mail_from_name TEXT,
  mail_from_address TEXT,

  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_secure BOOLEAN NOT NULL DEFAULT true,
  imap_user TEXT NOT NULL,
  imap_password_enc TEXT NOT NULL,

  smtp_host TEXT,
  smtp_port INTEGER,

  relay_url TEXT,
  relay_secret_enc TEXT,

  sent_folder TEXT NOT NULL DEFAULT 'INBOX.Sent',
  drafts_folder TEXT NOT NULL DEFAULT 'INBOX.Drafts',

  slack_webhook_url TEXT,
  reminder_threshold_days INTEGER NOT NULL DEFAULT 3,

  signature_json JSONB,

  last_reply_poll_uid INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A single OAuth authorization server (issuer = this service's root URL) is
-- shared by every tenant — the MCP SDK's auth router is designed to be
-- mounted once at the application root (it hardcodes
-- /.well-known/oauth-authorization-server relative to wherever it's
-- mounted, so nesting one per tenant under /t/:slug would serve that
-- metadata at the wrong, non-discoverable path). Clients/tokens are
-- therefore NOT tenant-scoped in storage; instead, each authorization
-- carries a "resource" parameter (RFC 8707 / the MCP authorization spec)
-- identifying which tenant's /t/:slug/mcp endpoint it's for — see
-- oauthProvider.js for how that's checked at login and re-checked as a
-- token audience match on every /t/:slug/mcp request.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_info JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  resource TEXT,
  expires_at BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT NOT NULL,
  industry TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replied', 'unresponsive', 'opted_out')),
  last_contacted_at TIMESTAMPTZ,
  last_reply_at TIMESTAMPTZ,
  next_followup_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  drip_step INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS contacts_tenant_status_idx ON contacts(tenant_id, status);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  subject TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_tenant_msgid_idx ON messages(tenant_id, message_id);

CREATE TABLE IF NOT EXISTS campaign_rules (
  tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb
);
`;

export async function migrate() {
  await query(SCHEMA);
}

// --- Secret encryption (IMAP/SMTP passwords, relay secrets) at rest ---
// AES-256-GCM with a key derived from CONFIG_ENCRYPTION_KEY. Derivation via
// sha256 means any length/format of input (a passphrase, a hex string from
// `openssl rand -hex 32`, etc) always yields a valid 32-byte key.

function encryptionKey() {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "Missing CONFIG_ENCRYPTION_KEY — set a random secret (e.g. `openssl rand -hex 32`) used to " +
        "encrypt tenant mailbox credentials at rest. Refusing to start without it."
    );
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext ?? ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(packed) {
  if (!packed) return "";
  const [ivB64, tagB64, dataB64] = packed.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted secret");
  const key = encryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// --- Passphrase hashing (a tenant's own Claude-connector access passphrase,
// distinct from their mailbox password, which is encrypted above not hashed
// since it must be recovered to log into IMAP/SMTP) ---

export function hashPassphrase(passphrase) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(passphrase), salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassphrase(passphrase, stored) {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(passphrase), salt, 64);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
