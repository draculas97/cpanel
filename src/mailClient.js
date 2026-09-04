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

// Sending goes over Resend's HTTPS API instead of raw SMTP. Render (and most
// PaaS free tiers) blocks outbound SMTP ports (25/465/587) to prevent abuse,
// which makes direct SMTP submission to an external mail server unreliable
// from here even though IMAP (993) works fine. Resend's API runs over HTTPS
// (443), which isn't blocked.
function splitAddresses(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendEmail({ to, subject, body, cc, bcc, html = false }) {
  if (!to) throw new Error("to is required");
  if (!subject) throw new Error("subject is required");
  if (!body) throw new Error("body is required");

  const apiKey = requireEnv("RESEND_API_KEY");
  const from = process.env.RESEND_FROM || process.env.SMTP_USER || requireEnv("IMAP_USER");

  const payload = {
    from,
    to: splitAddresses(to),
    subject,
  };
  if (cc) payload.cc = splitAddresses(cc);
  if (bcc) payload.bcc = splitAddresses(bcc);
  if (html) payload.html = body;
  else payload.text = body;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.message || data?.name || `HTTP ${res.status}`;
    throw new Error(`Resend API error: ${message}`);
  }

  return { messageId: data.id, accepted: payload.to, rejected: [] };
}
