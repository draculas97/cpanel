import express from "express";
import { createTenant, validateSlug } from "./tenants.js";
import { importContacts } from "./contacts.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function page({ title, body }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e6edf3;margin:0;padding:40px 16px;display:flex;justify-content:center}
  main{width:560px;max-width:100%}
  h1{font-size:20px}
  p.hint{font-size:13px;color:#9aa7b2}
  fieldset{border:1px solid #2d3742;border-radius:10px;padding:16px 20px;margin-bottom:16px}
  legend{padding:0 6px;font-size:13px;color:#9aa7b2}
  label{display:block;font-size:13px;margin:10px 0 4px;color:#c9d1d9}
  input[type=text],input[type=password],input[type=number],input[type=url],textarea{
    width:100%;padding:9px;border-radius:6px;border:1px solid #2d3742;background:#0b0f14;color:#e6edf3;
    box-sizing:border-box;font-size:14px;font-family:inherit}
  textarea{min-height:90px;font-family:ui-monospace,monospace;font-size:12px}
  .row{display:flex;gap:12px}
  .row > div{flex:1}
  button{width:100%;margin-top:20px;padding:12px;border-radius:6px;border:none;background:#2f81f7;color:white;font-size:14px;cursor:pointer}
  .err{background:#3d1418;border:1px solid #f85149;color:#f85149;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px}
  .ok{background:#0d2818;border:1px solid #2ea043;color:#7ee2a8;padding:14px;border-radius:8px;font-size:13px}
  code{background:#161b22;padding:2px 6px;border-radius:4px;font-size:12px;word-break:break-all}
</style></head>
<body><main>${body}</main></body></html>`;
}

function form({ error, values = {}, setupGated }) {
  const v = (k, d = "") => escapeHtml(values[k] ?? d);
  return page({
    title: "Set up a Stacia Mail tenant",
    body: `
      <h1>Set up a new mailbox</h1>
      <p class="hint">Registers a new tenant against this backend and hands back a personal MCP connector URL to paste into
      your own Claude's "Add custom connector" dialog. This is a one-time setup step — everything afterward (mail relay,
      reply watching, reminders) runs on the backend, nothing needs to keep running on your machine.</p>
      ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
      <form method="POST" action="setup">
        ${setupGated ? `
        <fieldset><legend>Setup access</legend>
          <label>Setup passphrase</label>
          <input type="password" name="setup_password" required />
        </fieldset>` : ""}
        <fieldset><legend>Tenant</legend>
          <label>Slug (used in your connector URL, e.g. "acme")</label>
          <input type="text" name="slug" value="${v("slug")}" pattern="[a-z0-9][a-z0-9-]*" required />
          <label>Display name</label>
          <input type="text" name="display_name" value="${v("display_name")}" />
          <label>Access passphrase (you'll type this once when Claude asks to authorize)</label>
          <input type="password" name="auth_passphrase" required />
        </fieldset>
        <fieldset><legend>Mailbox (IMAP)</legend>
          <div class="row">
            <div><label>IMAP host</label><input type="text" name="imap_host" value="${v("imap_host")}" required /></div>
            <div><label>Port</label><input type="number" name="imap_port" value="${v("imap_port", "993")}" /></div>
          </div>
          <label>Mailbox address (username)</label>
          <input type="text" name="imap_user" value="${v("imap_user")}" required />
          <label>Mailbox password</label>
          <input type="password" name="imap_password" required />
        </fieldset>
        <fieldset><legend>Sending (optional — leave blank to only draft, never send)</legend>
          <p class="hint">Most hosts (including this one) block outbound SMTP from a server, so sending real mail needs a
          small relay endpoint on your own mail host. Without one, outreach emails are still composed and saved to
          Drafts for you to send by hand.</p>
          <label>Relay URL</label>
          <input type="url" name="relay_url" value="${v("relay_url")}" />
          <label>Relay secret</label>
          <input type="password" name="relay_secret" />
        </fieldset>
        <fieldset><legend>Reminders</legend>
          <label>Slack incoming webhook URL</label>
          <input type="url" name="slack_webhook_url" value="${v("slack_webhook_url")}" />
          <label>Remind me after this many days unanswered</label>
          <input type="number" name="reminder_threshold_days" value="${v("reminder_threshold_days", "3")}" />
        </fieldset>
        <fieldset><legend>Initial contacts (optional)</legend>
          <p class="hint">One per line: <code>name,email,industry</code>. More can be added later via the add_contacts tool.</p>
          <textarea name="contacts_csv" placeholder="Jane Doe,jane@example.com,Manufacturing"></textarea>
        </fieldset>
        <button type="submit">Create tenant</button>
      </form>`,
  });
}

function successPage({ slug, connectorUrl, contactsImported }) {
  return page({
    title: "Tenant created",
    body: `
      <h1>Tenant "${escapeHtml(slug)}" is ready</h1>
      <div class="ok">
        <p>Paste this URL into Claude's <strong>Settings → Connectors → Add custom connector</strong>:</p>
        <p><code>${escapeHtml(connectorUrl)}</code></p>
        <p>Claude will open an Authorize screen — type in the access passphrase you just set. That's the only manual step;
        everything else (reply tracking, reminders, drip) runs on the backend from here on.</p>
        ${contactsImported ? `<p>${contactsImported} initial contact(s) imported.</p>` : ""}
      </div>`,
  });
}

function parseContactsCsv(text) {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^name\s*,\s*email/i.test(line))
    .map((line) => {
      const [name, email, industry] = line.split(",").map((s) => s?.trim());
      return { name: name || null, email, industry: industry || null };
    })
    .filter((c) => c.email);
}

export function buildSetupRouter({ getBaseUrl }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));

  const setupPassword = process.env.SETUP_PASSWORD;

  router.get("/", (_req, res) => {
    res.type("html").send(form({ setupGated: !!setupPassword }));
  });

  router.post("/", async (req, res) => {
    const body = req.body || {};
    if (setupPassword && body.setup_password !== setupPassword) {
      return res.status(401).type("html").send(form({ error: "Incorrect setup passphrase.", values: body, setupGated: true }));
    }

    try {
      validateSlug(body.slug);
      const tenant = await createTenant({
        slug: body.slug,
        displayName: body.display_name,
        authPassphrase: body.auth_passphrase,
        imapHost: body.imap_host,
        imapPort: body.imap_port ? Number(body.imap_port) : undefined,
        imapUser: body.imap_user,
        imapPassword: body.imap_password,
        relayUrl: body.relay_url || undefined,
        relaySecret: body.relay_secret || undefined,
        slackWebhookUrl: body.slack_webhook_url || undefined,
        reminderThresholdDays: body.reminder_threshold_days ? Number(body.reminder_threshold_days) : undefined,
      });

      const contacts = parseContactsCsv(body.contacts_csv);
      if (contacts.length) await importContacts(tenant.id, contacts);

      const connectorUrl = new URL(`t/${tenant.slug}/mcp`, getBaseUrl()).href;
      res.type("html").send(successPage({ slug: tenant.slug, connectorUrl, contactsImported: contacts.length }));
    } catch (err) {
      const message = err.code === "23505" ? "That slug is already taken — pick another." : err.message;
      res.status(400).type("html").send(form({ error: message, values: body, setupGated: !!setupPassword }));
    }
  });

  return router;
}
