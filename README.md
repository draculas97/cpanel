# cpanel-mail-mcp

A small remote MCP server that gives Claude four tools against your cPanel
mailbox over IMAP/SMTP: `list_folders`, `list_emails`, `read_email`,
`send_email`.

It's built for Claude's "Add custom connector" dialog, which requires an
**HTTPS URL** (not a local command) — so this needs to be deployed
somewhere reachable from the internet.

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
   | `MCP_TOKEN` | a long random string — generate with `openssl rand -hex 32` |
   | `IMAP_HOST` | e.g. `mail.staciacorp.com` |
   | `IMAP_PORT` | `993` |
   | `IMAP_USER` | `sarabeshsriram@staciacorp.com` |
   | `IMAP_PASSWORD` | your mailbox password |
   | `SMTP_HOST` | e.g. `mail.staciacorp.com` |
   | `SMTP_PORT` | `465` |

   Your password and token stay in Render's dashboard only — they're never
   typed into Claude or committed to git.

6. Click **Deploy**. Once live, Render shows a URL like
   `https://cpanel-mail-mcp-xxxx.onrender.com`.

## 2. Connect it in Claude

In Claude's **Settings → Connectors → Add custom connector**:

- **Name**: `cPanel Mail`
- **Remote MCP server URL**:
  `https://cpanel-mail-mcp-xxxx.onrender.com/mcp/<MCP_TOKEN>`
  (swap in your actual Render URL and the `MCP_TOKEN` value you set above —
  the token in the path is what keeps this endpoint private to you)

Click Continue. Claude should now list `list_folders`, `list_emails`,
`read_email`, `send_email` as available tools.

## Notes

- **Free-tier cold starts**: Render's free web services sleep after ~15
  minutes idle and take up to a minute to wake on the next request. Fine
  for occasional use; if that's annoying, upgrade to a paid instance later.
- **Security**: anyone with your full MCP URL (including the token) can
  read and send mail as you. Treat it like a password — don't post it
  anywhere public. If it ever leaks, change `MCP_TOKEN` in Render and
  update the connector URL in Claude.
- **Local testing**: `cp .env.example .env`, fill it in, `npm install`,
  `npm start`, then hit `http://localhost:3000/mcp/<token>`.
