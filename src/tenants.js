import { query, encryptSecret, decryptSecret, hashPassphrase } from "./db.js";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export function validateSlug(slug) {
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error(
      "Tenant slug must be lowercase letters, digits, and hyphens only (e.g. 'stacia', 'acme-corp')."
    );
  }
  return slug;
}

function rowToTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    authPassphraseHash: row.auth_passphrase_hash,
    mailFromName: row.mail_from_name,
    mailFromAddress: row.mail_from_address,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure,
    imapUser: row.imap_user,
    imapPasswordEnc: row.imap_password_enc,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    relayUrl: row.relay_url,
    relaySecretEnc: row.relay_secret_enc,
    sentFolder: row.sent_folder,
    draftsFolder: row.drafts_folder,
    slackWebhookUrl: row.slack_webhook_url,
    reminderThresholdDays: row.reminder_threshold_days,
    signature: row.signature_json || null,
    lastReplyPollUid: row.last_reply_poll_uid,
    createdAt: row.created_at,
  };
}

export async function getTenantBySlug(slug) {
  const { rows } = await query("SELECT * FROM tenants WHERE slug = $1", [slug]);
  return rowToTenant(rows[0]);
}

export async function getTenantById(id) {
  const { rows } = await query("SELECT * FROM tenants WHERE id = $1", [id]);
  return rowToTenant(rows[0]);
}

export async function listTenants() {
  const { rows } = await query("SELECT * FROM tenants ORDER BY id");
  return rows.map(rowToTenant);
}

export async function createTenant({
  slug,
  displayName,
  authPassphrase,
  mailFromName,
  mailFromAddress,
  imapHost,
  imapPort,
  imapSecure,
  imapUser,
  imapPassword,
  smtpHost,
  smtpPort,
  relayUrl,
  relaySecret,
  sentFolder,
  draftsFolder,
  slackWebhookUrl,
  reminderThresholdDays,
  signature,
}) {
  validateSlug(slug);
  if (!authPassphrase) throw new Error("authPassphrase is required");
  if (!imapHost || !imapUser || !imapPassword) {
    throw new Error("imapHost, imapUser and imapPassword are required");
  }

  const { rows } = await query(
    `INSERT INTO tenants (
       slug, display_name, auth_passphrase_hash,
       mail_from_name, mail_from_address,
       imap_host, imap_port, imap_secure, imap_user, imap_password_enc,
       smtp_host, smtp_port,
       relay_url, relay_secret_enc,
       sent_folder, drafts_folder,
       slack_webhook_url, reminder_threshold_days,
       signature_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      slug,
      displayName || slug,
      hashPassphrase(authPassphrase),
      mailFromName || null,
      mailFromAddress || imapUser,
      imapHost,
      imapPort || 993,
      imapSecure !== false,
      imapUser,
      encryptSecret(imapPassword),
      smtpHost || imapHost,
      smtpPort || 465,
      relayUrl || null,
      relaySecret ? encryptSecret(relaySecret) : null,
      sentFolder || "INBOX.Sent",
      draftsFolder || "INBOX.Drafts",
      slackWebhookUrl || null,
      reminderThresholdDays || 3,
      signature ? JSON.stringify(signature) : null,
    ]
  );
  return rowToTenant(rows[0]);
}

// Resolves a tenant record into the plain config createMailClient() needs,
// decrypting secrets only at the point of use.
export function resolveMailConfig(tenant) {
  return {
    imapHost: tenant.imapHost,
    imapPort: tenant.imapPort,
    imapSecure: tenant.imapSecure,
    imapUser: tenant.imapUser,
    imapPassword: decryptSecret(tenant.imapPasswordEnc),
    smtpHost: tenant.smtpHost,
    smtpPort: tenant.smtpPort,
    relayUrl: tenant.relayUrl,
    relaySecret: tenant.relaySecretEnc ? decryptSecret(tenant.relaySecretEnc) : null,
    sentFolder: tenant.sentFolder,
    draftsFolder: tenant.draftsFolder,
    mailFromName: tenant.mailFromName,
    mailFromAddress: tenant.mailFromAddress,
    signature: tenant.signature,
    // Used to build outbound Message-IDs (`<uuid>@domain>`); falls back to
    // the mailbox's own domain when unset.
    messageIdDomain: (tenant.mailFromAddress || tenant.imapUser || "").split("@")[1] || "localhost",
  };
}

export async function setLastReplyPollUid(tenantId, uid) {
  await query("UPDATE tenants SET last_reply_poll_uid = $2 WHERE id = $1", [tenantId, uid]);
}

export async function markReminderThreshold(tenantId, days) {
  await query("UPDATE tenants SET reminder_threshold_days = $2 WHERE id = $1", [tenantId, days]);
}

// Auto-provisions a tenant from the legacy single-mailbox env vars
// (IMAP_HOST / IMAP_USER / IMAP_PASSWORD / AUTH_PASSWORD / RELAY_URL /
// RELAY_SECRET, as documented in env.example) the first time the
// multi-tenant backend boots against a fresh database, so the existing
// "Stacia Mail" connector keeps working under a tenant slug instead of
// silently losing its mailbox config. No-op if that tenant already exists,
// or if the legacy env vars aren't set (a fresh multi-tenant-only deploy).
export async function bootstrapLegacyTenantFromEnv() {
  const slug = process.env.LEGACY_TENANT_SLUG || "stacia";
  const authPassphrase = process.env.AUTH_PASSWORD || process.env.MCP_TOKEN;
  const imapHost = process.env.IMAP_HOST;
  const imapUser = process.env.IMAP_USER;
  const imapPassword = process.env.IMAP_PASSWORD;

  if (!authPassphrase || !imapHost || !imapUser || !imapPassword) {
    return null; // no legacy single-tenant env configured — nothing to bootstrap
  }

  const existing = await getTenantBySlug(slug);
  if (existing) return existing;

  console.log(`Bootstrapping legacy single-tenant mailbox as tenant "${slug}" from environment variables...`);
  return createTenant({
    slug,
    displayName: "Stacia Mail",
    authPassphrase,
    mailFromName: process.env.MAIL_FROM_NAME || "Sarabesh Sriram",
    mailFromAddress: process.env.MAIL_FROM_ADDRESS || imapUser,
    imapHost,
    imapPort: Number(process.env.IMAP_PORT || 993),
    imapSecure: (process.env.IMAP_SECURE ?? "true") === "true",
    imapUser,
    imapPassword,
    smtpHost: process.env.SMTP_HOST || imapHost,
    smtpPort: Number(process.env.SMTP_PORT || 465),
    relayUrl: process.env.RELAY_URL || null,
    relaySecret: process.env.RELAY_SECRET || null,
    sentFolder: process.env.SENT_FOLDER || "INBOX.Sent",
    draftsFolder: process.env.DRAFTS_FOLDER || "INBOX.Drafts",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || null,
  });
}
