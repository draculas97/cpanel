# Stacia Mail — multi-tenant outreach system

A hosted, multi-tenant backend that gives each tenant's own Claude a
personal MCP connector into their own cPanel-style (IMAP/SMTP) mailbox — no
third-party email service — plus a built-in outreach/contacts system:
Claude drafts outreach emails, the backend watches for replies (and goes
quiet on any thread that gets one), reminds the mailbox owner via Slack
about contacts who've gone unanswered, and can drip further emails to
non-responders on a configured cadence.

This began as a single-mailbox MCP server (`cpanel-mail-mcp`) and was
rebuilt multi-tenant from here: one deployment, one Postgres database,
any number of independent mailboxes/contact lists, each reachable at its
own connector URL.

## How it's put together

- **One shared OAuth authorization server** (`/authorize`, `/token`,
  `/register`, `/revoke`) at this service's root — the MCP SDK's auth
  router is designed to be mounted once at the application root, so rather
  than one per tenant, every tenant is disambiguated via the standard
  `resource` parameter (RFC 8707 / the MCP authorization spec), which
  Claude's connector already sends. See `src/oauthProvider.js` for the
  reasoning and `tenantAudienceCheck` in `src/server.js` for the check
  that stops one tenant's token from working against another tenant's
  mailbox.
- **Per-tenant MCP endpoint**: `https://<host>/t/<slug>/mcp` — this is the
  URL you paste into Claude's "Add custom connector" dialog.
- **Postgres** (`DATABASE_URL`) holds tenants, OAuth clients/tokens,
  contacts, messages, and campaign rules — see `src/db.js` for the schema.
  Mailbox passwords and relay secrets are encrypted at rest
  (`CONFIG_ENCRYPTION_KEY`); access passphrases are hashed, never stored
  in plain text.
- **Background jobs** (`src/jobs.js`) run inside this same process on a
  timer — not tied to any live Claude session or local machine:
  - `pollReplies` — diffs each tenant's INBOX against its last-seen UID
    and matches new messages' `In-Reply-To` header against outbound
    Message-IDs we recorded, marking that contact `replied`.
  - `checkReminders` — pings the tenant's Slack webhook for any `active`
    contact unanswered past `reminder_threshold_days`.
  - `runDrip` — advances a tenant's configured drip templates for
    non-responders. **No-ops until a tenant explicitly calls
    `set_campaign_rules`** — composition/cadence are never invented.

## Deploying

1. Provision a Postgres database (Render's own Postgres, Supabase's free
   tier, etc — anything reachable via a `DATABASE_URL` connection string).
2. Deploy this repo (Render: New + → Web Service → this repo; the
   `Dockerfile` is picked up automatically).
3. Set environment variables — see `env.example` for the full list.
   Required: `BASE_URL` (usually automatic on Render via
   `RENDER_EXTERNAL_URL`), `DATABASE_URL`, `CONFIG_ENCRYPTION_KEY`
   (`openssl rand -hex 32`). Set `SETUP_PASSWORD` unless this deploy is
   private to people you already trust to onboard tenants.
4. Deploy. On boot the service creates its tables if they don't exist yet.

### Migrating an existing single-mailbox deployment

If you're moving the original single-tenant `cpanel-mail-mcp` service onto
this backend: keep its existing `IMAP_*` / `AUTH_PASSWORD` / `RELAY_*` env
vars set alongside the new ones above. On first boot against a fresh
database, the service automatically creates a tenant (slug `stacia` by
default, override with `LEGACY_TENANT_SLUG`) from those values — see
`bootstrapLegacyTenantFromEnv()` in `src/tenants.js`. Its connector URL is
then `https://<host>/t/stacia/mcp` instead of the old `/mcp` — reconnect
Claude's "Stacia Mail" connector to that new URL and re-authorize with the
same passphrase as before.

## Onboarding a new tenant

Visit `https://<host>/setup`. It collects: a slug, an access passphrase,
IMAP credentials, an optional send relay (see below), an optional Slack
webhook + reminder threshold, and an optional initial contact list
(`name,email,industry` per line). On submit it hands back the tenant's
`/t/<slug>/mcp` connector URL to paste into their Claude.

**About sending mail**: most hosts (including this one, on Render) block
outbound SMTP from a server, so actually *sending* mail needs a small relay
endpoint on the tenant's own mail host (a small PHP script that calls
`mail()` locally — one relay per mailbox, not shared or included in this
repo, since it lives on each tenant's own cPanel account). Without one
configured, a tenant can still `draft_email`/`draft_outreach_email` (saved
via IMAP APPEND straight to Drafts) but not `send_email`/
`send_outreach_email`. Drafting-only is the safer default anyway — nothing
goes out until a human sends it.

## MCP tools

`list_folders`, `list_emails`, `read_email`, `send_email`, `draft_email` —
general mailbox access, unchanged from the original single-tenant server.

`list_contacts`, `add_contacts`, `update_contact_status`,
`draft_outreach_email`, `send_outreach_email`, `get_campaign_rules`,
`set_campaign_rules` — the outreach/contacts layer described above.

## Still open (don't invent these — ask first)

- **Composition rules** for outreach emails — tone/content, not yet
  defined by the mailbox owner.
- **Drip cadence and reminder threshold defaults** — configurable per
  tenant (`reminder_threshold_days`, `campaign_rules.drip.cadenceDays`),
  but no cross-tenant default beyond what's in the setup wizard/schema
  has been agreed as "correct" — treat those as placeholders to tune, not
  settled numbers.
- **Distributable setup tool platform** — the original ask was framed as
  "an exe file"; this instead ships as a web-based `/setup` wizard, since
  it needed no native installer to hand back a connector URL and doesn't
  raise a Windows-vs-Mac question. If a native installer is still wanted
  for a specific reason, that's a separate, unstarted piece of work.
- **Slack integration model** — currently one webhook URL per tenant
  (matches the original data-model sketch). A shared Stacia Slack app that
  tenants authorize instead hasn't been built.

## Operational notes carried over from the single-tenant version

- Sending mail goes through a small PHP relay hosted on the tenant's own
  cPanel account, not raw SMTP — Render (and most PaaS hosts) block
  outbound SMTP ports even though IMAP works fine.
- Some cPanel hosts run bot-protection (e.g. BitNinja "Human Presence
  Check") that challenges non-browser requests — this is why signature
  images are inline CID MIME attachments rather than hosted URLs, and why
  `sendEmail` retries once against a bot-protection cookie challenge.
- OAuth clients/tokens now persist in Postgres (`oauth_clients`,
  `oauth_tokens`), so a redeploy no longer forces every connector to fully
  Disconnect+Reconnect — only in-flight authorizations (5-minute window)
  are lost on a restart, same as before.
