# cpanel-mail-mcp

A small remote MCP server that gives Claude four tools against your cPanel
mailbox over IMAP/SMTP: `list_folders`, `list_emails`, `read_email`,
`send_email`.

It's built for Claude's "Add custom connector" dialog, which requires an
**HTTPS URL** (not a local command) and speaks OAuth 2.1 — so this needs to
be deployed somewhere reachable from the internet, and it implements a real
(if minimal) single-user OAuth flow rather than a bare shared secret.

## 1. Deploy to Render (free, no local setup needed)

1. Create a **new GitHub repo** (private is fine) and push this folder to it.
2. Go to [render.com](https://render.com) and sign in (GitHub login is easiest).
3. **New +** → **Web Service** → connect the repo you just pushed.
4. Render will detect the `Dockerfile` automatically. Leave build/start
   commands blank (Docker handles it). Pick the **Free** instance type.
5. Under **Environment**, add these variables (get exact IMAP/SMTP
   host+port from cPanel → Email Accounts → your address → **Connect
   Devices**, since it isn't always `mail.yourdomain.com`):

   | Key | Value |
   |---|---|
   | `MCP_TOKEN` | a long random string — generate with `openssl rand -hex 32`. This is now your **login passphrase** (see step 2). |
   | `IMAP_HOST` | e.g. `mail.staciacorp.com` |
   | `IMAP_PORT` | `993` |
   | `IMAP_USER` | `sarabeshsriram@staciacorp.com` |
   | `IMAP_PASSWORD` | your mailbox password |
   | `SMTP_HOST` | e.g. `mail.staciacorp.com` |
   | `SMTP_PORT` | `465` |

   You do **not** need to set `BASE_URL` on Render — it auto-detects its own
   public URL via `RENDER_EXTERNAL_URL`. (Set it only if deploying elsewhere.)

   Your password and passphrase stay in Render's dashboard only — they're
   never typed into Claude's connector fields or committed to git.

6. Click **Deploy**. Once live, Render shows a URL like
   `https://cpanel-mail-mcp-xxxx.onrender.com`.

## 2. Connect it in Claude

In Claude's **Settings → Connectors → Add custom connector**:

- **Name**: `Stacia Mail` (or anything you like)
- **Remote MCP server URL**: `https://cpanel-mail-mcp-xxxx.onrender.com/mcp`
  (just the URL — no token in it anymore)

Click Continue. Claude will register itself with the server and open a
browser tab asking you to authorize — a simple page with one password field.
**Type in your `MCP_TOKEN` value** (the passphrase from step 1) and click
Authorize. You only do this once; Claude stores the resulting access token
and refreshes it automatically after that.

Once authorized, Claude should list `list_folders`, `list_emails`,
`read_email`, `send_email` as available tools.

## Notes

- **Free-tier cold starts**: Render's free web services sleep after ~15
  minutes idle and take up to a minute to wake on the next request. Fine
  for occasional use; if that's annoying, upgrade to a paid instance later.
- **Security**: the passphrase is only ever typed once, into the browser
  authorize screen — never into Claude's connector fields, never over the
  API. After that, Claude holds a short-lived access token (1 hour) plus a
  refresh token, both stored server-side in memory. Because this server
  keeps its OAuth state in memory, **it forgets all issued tokens and
  registered clients on every restart/redeploy** — Claude will silently
  re-register and you'll get one more authorize prompt the next time you
  use it after a restart. If the passphrase ever leaks, change `MCP_TOKEN`
  in Render and redeploy; anyone with the old value won't be able to
  authorize a new client, though already-issued tokens stay valid until
  they expire (≤1 hour) since a restart clears them anyway.
- **Local testing**: `cp .env.example .env`, fill it in (including
  `BASE_URL=http://localhost:3000`), `npm install`, `npm start`, then point
  a connector at `http://localhost:3000/mcp`.
