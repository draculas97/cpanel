import { listTenants } from "./tenants.js";
import { resolveMailConfig, setLastReplyPollUid } from "./tenants.js";
import { createMailClient } from "./mailClient.js";
import {
  recordInboundReply,
  findContactsNeedingReminder,
  markReminderSent,
  findContactsForDrip,
  getCampaignRules,
  recordOutboundMessage,
  advanceDripStep,
} from "./contacts.js";

// These three jobs are intentionally decoupled from any live Claude
// session or local process — they run continuously inside this same
// Node/Express service on a timer, per the plan's requirement that reply
// tracking and reminders not depend on anything staying open elsewhere.

async function forEachTenantSafely(label, fn) {
  let tenants;
  try {
    tenants = await listTenants();
  } catch (err) {
    console.error(`[jobs:${label}] failed to list tenants:`, err.message);
    return;
  }
  for (const tenant of tenants) {
    try {
      await fn(tenant);
    } catch (err) {
      // One tenant's IMAP/Slack/DB hiccup must never stop the others.
      console.error(`[jobs:${label}] tenant "${tenant.slug}" failed:`, err.message);
    }
  }
}

// Watches for replies by diffing INBOX against each tenant's last-seen UID
// and matching the new messages' In-Reply-To header against our own
// recorded outbound Message-IDs. A contact that replies is marked
// 'replied' and drops out of the reminder/drip queues — the system then
// leaves that thread alone, per the plan.
export async function pollReplies() {
  await forEachTenantSafely("pollReplies", async (tenant) => {
    const mail = createMailClient(resolveMailConfig(tenant));
    const { messages, highestUid } = await mail.fetchEnvelopesSinceUid({
      folder: "INBOX",
      sinceUid: tenant.lastReplyPollUid,
    });

    for (const msg of messages) {
      if (!msg.inReplyTo) continue;
      const contact = await recordInboundReply(tenant.id, {
        inReplyTo: msg.inReplyTo,
        subject: msg.subject,
        messageId: msg.messageId,
      });
      if (contact) {
        console.log(`[jobs:pollReplies] tenant "${tenant.slug}": ${contact.email} replied — marked 'replied'.`);
      }
    }

    if (highestUid > tenant.lastReplyPollUid) {
      await setLastReplyPollUid(tenant.id, highestUid);
    }
  });
}

// Pings the tenant's Slack webhook for any contact that's gone unanswered
// past their configured reminder_threshold_days. Does not chase the
// contact itself — this is a reminder to the mailbox owner, per the plan.
export async function checkReminders() {
  await forEachTenantSafely("checkReminders", async (tenant) => {
    if (!tenant.slackWebhookUrl) return;

    const due = await findContactsNeedingReminder(tenant.id, tenant.reminderThresholdDays);
    for (const contact of due) {
      const days = tenant.reminderThresholdDays;
      const text =
        `:alarm_clock: *${contact.name || contact.email}* (${contact.email}) hasn't replied in ${days}+ days.\n` +
        `Tenant: ${tenant.slug}${contact.industry ? ` · Industry: ${contact.industry}` : ""}`;

      const res = await fetch(tenant.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        throw new Error(`Slack webhook returned HTTP ${res.status} for contact ${contact.email}`);
      }
      await markReminderSent(tenant.id, contact.id);
    }
  });
}

// Advances the configured drip campaign for non-responders. This is a
// scheduling mechanism only — it never invents email content or cadence.
// A tenant must explicitly set campaign_rules.drip = { cadenceDays,
// templates: [{subject, body}, ...], autoSend } via the set_campaign_rules
// MCP tool before this does anything; with no rules configured (the
// default for every tenant today, since composition rules are still
// TBD — see README) it's a no-op. autoSend defaults to false, meaning
// drip messages are drafted for review rather than sent automatically,
// consistent with this system's draft-first default everywhere else.
export async function runDrip() {
  await forEachTenantSafely("runDrip", async (tenant) => {
    const rules = await getCampaignRules(tenant.id);
    const drip = rules?.drip;
    if (!drip || !Array.isArray(drip.templates) || drip.templates.length === 0) return;

    const cadenceDays = Number(drip.cadenceDays) || 7;
    const mail = createMailClient(resolveMailConfig(tenant));
    const due = await findContactsForDrip(tenant.id, cadenceDays);

    for (const contact of due) {
      const template = drip.templates[contact.dripStep];
      if (!template) continue; // exhausted the configured templates — leave it to the reminder job

      const send = drip.autoSend ? mail.sendEmail : mail.draftEmail;
      const result = await send({ to: contact.email, subject: template.subject, body: template.body, html: !!template.html });
      await recordOutboundMessage(tenant.id, contact.id, { subject: template.subject, messageId: result.messageId });
      await advanceDripStep(tenant.id, contact.id);
    }
  });
}

function everyMinutes(minutes, fn, label) {
  const ms = Math.max(1, minutes) * 60_000;
  const tick = () => {
    fn().catch((err) => console.error(`[jobs:${label}] unhandled error:`, err));
  };
  tick(); // run once at boot rather than waiting a full interval
  return setInterval(tick, ms);
}

export function startBackgroundJobs() {
  const replyPollMinutes = Number(process.env.REPLY_POLL_INTERVAL_MINUTES || 5);
  const reminderMinutes = Number(process.env.REMINDER_CHECK_INTERVAL_MINUTES || 30);
  const dripMinutes = Number(process.env.DRIP_CHECK_INTERVAL_MINUTES || 60);

  console.log(
    `Starting background jobs: reply poll every ${replyPollMinutes}m, reminders every ${reminderMinutes}m, drip every ${dripMinutes}m.`
  );

  return [
    everyMinutes(replyPollMinutes, pollReplies, "pollReplies"),
    everyMinutes(reminderMinutes, checkReminders, "checkReminders"),
    everyMinutes(dripMinutes, runDrip, "runDrip"),
  ];
}
