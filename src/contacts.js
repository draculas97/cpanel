import { query } from "./db.js";

const VALID_STATUSES = new Set(["active", "replied", "unresponsive", "opted_out"]);

function rowToContact(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    industry: row.industry,
    status: row.status,
    lastContactedAt: row.last_contacted_at,
    lastReplyAt: row.last_reply_at,
    nextFollowupAt: row.next_followup_at,
    reminderSentAt: row.reminder_sent_at,
    dripStep: row.drip_step,
    createdAt: row.created_at,
  };
}

export async function addContact(tenantId, { name, email, industry }) {
  if (!email) throw new Error("email is required");
  const { rows } = await query(
    `INSERT INTO contacts (tenant_id, name, email, industry)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, contacts.name),
       industry = COALESCE(EXCLUDED.industry, contacts.industry)
     RETURNING *`,
    [tenantId, name || null, String(email).trim().toLowerCase(), industry || null]
  );
  return rowToContact(rows[0]);
}

// Bulk import — used by both the setup wizard's initial contact paste and
// an `add_contacts` MCP tool. Each entry: { name, email, industry }.
export async function importContacts(tenantId, contacts) {
  const results = [];
  for (const c of contacts) {
    if (!c.email) continue;
    results.push(await addContact(tenantId, c));
  }
  return results;
}

export async function listContacts(tenantId, { status } = {}) {
  if (status) {
    const { rows } = await query(
      "SELECT * FROM contacts WHERE tenant_id = $1 AND status = $2 ORDER BY id",
      [tenantId, status]
    );
    return rows.map(rowToContact);
  }
  const { rows } = await query("SELECT * FROM contacts WHERE tenant_id = $1 ORDER BY id", [tenantId]);
  return rows.map(rowToContact);
}

export async function getContactByEmail(tenantId, email) {
  const { rows } = await query("SELECT * FROM contacts WHERE tenant_id = $1 AND email = $2", [
    tenantId,
    String(email).trim().toLowerCase(),
  ]);
  return rowToContact(rows[0]);
}

export async function updateContactStatus(tenantId, email, status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`status must be one of: ${Array.from(VALID_STATUSES).join(", ")}`);
  }
  const { rows } = await query(
    "UPDATE contacts SET status = $3 WHERE tenant_id = $1 AND email = $2 RETURNING *",
    [tenantId, String(email).trim().toLowerCase(), status]
  );
  return rowToContact(rows[0]);
}

// Called right after an outreach email is drafted/sent to a contact:
// records the message and stamps last_contacted_at so reminder/drip jobs
// have a clock to measure from.
export async function recordOutboundMessage(tenantId, contactId, { subject, messageId }) {
  await query(
    `INSERT INTO messages (tenant_id, contact_id, direction, subject, message_id)
     VALUES ($1, $2, 'outbound', $3, $4)`,
    [tenantId, contactId, subject || null, messageId || null]
  );
  await query(
    `UPDATE contacts SET last_contacted_at = now()
     WHERE tenant_id = $1 AND id = $2 AND status != 'opted_out'`,
    [tenantId, contactId]
  );
}

// Matches an inbound message's In-Reply-To header back to a contact via the
// outbound message we recorded, marks that contact as replied (so it drops
// out of reminder/drip queues), and records the inbound message.
export async function recordInboundReply(tenantId, { inReplyTo, subject, messageId }) {
  if (!inReplyTo) return null;
  const { rows } = await query(
    `SELECT contact_id FROM messages
     WHERE tenant_id = $1 AND direction = 'outbound' AND message_id = $2
     ORDER BY id DESC LIMIT 1`,
    [tenantId, inReplyTo]
  );
  const contactId = rows[0]?.contact_id;
  if (!contactId) return null;

  await query(
    `INSERT INTO messages (tenant_id, contact_id, direction, subject, message_id, in_reply_to)
     VALUES ($1, $2, 'inbound', $3, $4, $5)`,
    [tenantId, contactId, subject || null, messageId || null, inReplyTo]
  );
  const { rows: updated } = await query(
    `UPDATE contacts SET status = 'replied', last_reply_at = now()
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, contactId]
  );
  return rowToContact(updated[0]);
}

// Contacts that have gone unanswered longer than the tenant's reminder
// threshold and haven't already been reminded about since the last outreach.
export async function findContactsNeedingReminder(tenantId, thresholdDays) {
  const { rows } = await query(
    `SELECT * FROM contacts
     WHERE tenant_id = $1
       AND status = 'active'
       AND last_contacted_at IS NOT NULL
       AND last_contacted_at < now() - ($2 || ' days')::interval
       AND (reminder_sent_at IS NULL OR reminder_sent_at < last_contacted_at)
     ORDER BY last_contacted_at ASC`,
    [tenantId, thresholdDays]
  );
  return rows.map(rowToContact);
}

export async function markReminderSent(tenantId, contactId) {
  await query("UPDATE contacts SET reminder_sent_at = now() WHERE tenant_id = $1 AND id = $2", [
    tenantId,
    contactId,
  ]);
}

// Active, non-replied contacts due for the next drip step: last contacted
// at least cadenceDays ago, and still have a template left at their current
// drip_step index (the caller checks that against its own template list).
export async function findContactsForDrip(tenantId, cadenceDays) {
  const { rows } = await query(
    `SELECT * FROM contacts
     WHERE tenant_id = $1
       AND status = 'active'
       AND last_contacted_at IS NOT NULL
       AND last_contacted_at < now() - ($2 || ' days')::interval
     ORDER BY last_contacted_at ASC`,
    [tenantId, cadenceDays]
  );
  return rows.map(rowToContact);
}

export async function advanceDripStep(tenantId, contactId) {
  await query("UPDATE contacts SET drip_step = drip_step + 1 WHERE tenant_id = $1 AND id = $2", [
    tenantId,
    contactId,
  ]);
}

export async function getCampaignRules(tenantId) {
  const { rows } = await query("SELECT rules FROM campaign_rules WHERE tenant_id = $1", [tenantId]);
  return rows[0]?.rules || {};
}

export async function setCampaignRules(tenantId, rules) {
  await query(
    `INSERT INTO campaign_rules (tenant_id, rules) VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET rules = EXCLUDED.rules`,
    [tenantId, JSON.stringify(rules)]
  );
}
