import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function imapConfig() {
  return {
    host: requireEnv("IMAP_HOST"),
    port: Number(process.env.IMAP_PORT || 993),
    secure: (process.env.IMAP_SECURE ?? "true") === "true",
    auth: {
      user: requireEnv("IMAP_USER"),
      pass: requireEnv("IMAP_PASSWORD"),
    },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  };
}

async function withImap(fn) {
  const client = new ImapFlow(imapConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// Sending goes through a small PHP relay hosted on the same cPanel account
// as the mailbox (see relay/send.php), not raw SMTP. Render's outbound SMTP
// ports get blocked (25/465/587 all time out) even though IMAP works fine,
// so the relay lets the mail server send the message locally, on its own
// machine, instead of over a network path that gets blocked. The relay is
// still entirely your own infrastructure — no third-party mail service.

export async function listFolders() {
  return withImap(async (client) => {
    const list = await client.list();
    return list.map((f) => ({
      path: f.path,
      name: f.name,
      specialUse: f.specialUse || null,
      flags: Array.from(f.flags || []),
    }));
  });
}

export async function listEmails({ folder = "INBOX", limit = 20, unseenOnly = false }) {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const mailbox = client.mailbox;
      const total = mailbox.exists || 0;
      if (total === 0) return { folder, total: 0, messages: [] };

      const searchCriteria = unseenOnly ? { seen: false } : { all: true };
      let uids = await client.search(searchCriteria, { uid: true });
      uids = uids.sort((a, b) => b - a).slice(0, limit);
      if (uids.length === 0) return { folder, total, messages: [] };

      const messages = [];
      for await (const msg of client.fetch(
        uids,
        { envelope: true, flags: true, uid: true, size: true },
        { uid: true }
      )) {
        messages.push({
          uid: msg.uid,
          subject: msg.envelope?.subject || "(no subject)",
          from: (msg.envelope?.from || [])
            .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
            .join(", "),
          to: (msg.envelope?.to || [])
            .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
            .join(", "),
          date: msg.envelope?.date || null,
          seen: msg.flags?.has("\\Seen") || false,
          size: msg.size,
        });
      }
      messages.sort((a, b) => (b.uid || 0) - (a.uid || 0));
      return { folder, total, messages };
    } finally {
      lock.release();
    }
  });
}

export async function readEmail({ folder = "INBOX", uid }) {
  if (!uid) throw new Error("uid is required");
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const raw = await client.download(String(uid), undefined, { uid: true });
      if (!raw) throw new Error(`Message uid ${uid} not found in ${folder}`);
      const chunks = [];
      for await (const chunk of raw.content) chunks.push(chunk);
      const parsed = await simpleParser(Buffer.concat(chunks));
      return {
        uid,
        folder,
        subject: parsed.subject || "(no subject)",
        from: parsed.from?.text || "",
        to: parsed.to?.text || "",
        cc: parsed.cc?.text || "",
        date: parsed.date ? parsed.date.toISOString() : null,
        text: parsed.text || "",
        html: parsed.html || null,
        attachments: (parsed.attachments || []).map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

export async function sendEmail({ to, subject, body, cc, bcc, html = false }) {
  if (!to) throw new Error("to is required");
  if (!subject) throw new Error("subject is required");
  if (!body) throw new Error("body is required");

  const relayUrl = requireEnv("RELAY_URL");
  const relaySecret = requireEnv("RELAY_SECRET");

  const res = await fetch(relayUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${relaySecret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      // Some hosts front PHP endpoints with a WAF/bot-manager that blocks
      // requests carrying a generic server-side User-Agent (Node's default).
      // A normal browser-looking UA avoids that without weakening the relay's
      // own auth (the bearer secret is still required).
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ to, subject, body, cc, bcc, html }),
  });

  const rawText = await res.text();
  let data = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    // Non-JSON response (WAF block page, host error page, etc.) — keep a
    // trimmed snippet so failures are diagnosable from server logs alone.
  }

  if (!res.ok || !data.ok) {
    const snippet = rawText ? rawText.slice(0, 300) : "";
    throw new Error(
      `Relay error: ${data.error || `HTTP ${res.status}`}${
        snippet ? ` | body: ${snippet}` : ""
      }`
    );
  }

  return { accepted: data.accepted || [], rejected: [] };
}
