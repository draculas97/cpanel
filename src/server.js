import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createMailClient } from "./mailClient.js";
import { createOAuthProvider } from "./oauthProvider.js";
import { migrate } from "./db.js";
import { getTenantBySlug, resolveMailConfig, bootstrapLegacyTenantFromEnv } from "./tenants.js";
import {
  listContacts,
  importContacts,
  addContact,
  updateContactStatus,
  recordOutboundMessage,
  getCampaignRules,
  setCampaignRules,
} from "./contacts.js";
import { startBackgroundJobs } from "./jobs.js";
import { buildSetupRouter } from "./setupWizard.js";

const PORT = Number(process.env.PORT || 3000);

// The public HTTPS URL this service is reachable at. Render sets
// RENDER_EXTERNAL_URL automatically; BASE_URL is there as an override/for
// other hosts. This is the OAuth issuer/root for every tenant — see
// oauthProvider.js for why there's exactly one authorization server
// shared by all tenants rather than one per tenant.
const rawBaseUrl = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL;
if (!rawBaseUrl) {
  console.error(
    "FATAL: set BASE_URL to this service's public HTTPS URL (e.g. https://your-app.onrender.com). On Render this is normally set automatically via RENDER_EXTERNAL_URL. Refusing to start."
  );
  process.exit(1);
}
const BASE_URL = new URL(rawBaseUrl.replace(/\/+$/, "") + "/");

function tenantResourceUrl(slug) {
  return new URL(`t/${slug}/mcp`, BASE_URL);
}

const CONTACT_STATUS_ENUM = z.enum(["active", "replied", "unresponsive", "opted_out"]);

function buildMcpServer(tenant) {
  const mail = createMailClient(resolveMailConfig(tenant));
  const server = new McpServer(
    { name: `stacia-mail-${tenant.slug}`, version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "list_folders",
    {
      title: "List mail folders",
      description: "List the folders/mailboxes available in this mailbox (e.g. INBOX, Sent, Drafts).",
      inputSchema: {},
    },
    async () => {
      const folders = await mail.listFolders();
      return { content: [{ type: "text", text: JSON.stringify(folders, null, 2) }] };
    }
  );

  server.registerTool(
    "list_emails",
    {
      title: "List emails",
      description:
        "List recent emails in a folder (default INBOX), newest first. Returns uid, subject, from, to, date, seen, size for each.",
      inputSchema: {
        folder: z.string().optional().describe("Mailbox folder path, default INBOX"),
        limit: z.number().int().min(1).max(100).optional().describe("Max number of messages to return, default 20"),
        unseen_only: z.boolean().optional().describe("Only return unread messages, default false"),
      },
    },
    async ({ folder, limit, unseen_only }) => {
      const result = await mail.listEmails({ folder: folder || "INBOX", limit: limit || 20, unseenOnly: !!unseen_only });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "read_email",
    {
      title: "Read email",
      description: "Fetch the full content (text/html body, headers, attachment list) of one email by uid.",
      inputSchema: {
        uid: z.number().int().describe("The message UID, as returned by list_emails"),
        folder: z.string().optional().describe("Mailbox folder path, default INBOX"),
      },
    },
    async ({ uid, folder }) => {
      const result = await mail.readEmail({ uid, folder: folder || "INBOX" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "send_email",
    {
      title: "Send email",
      description:
        "Send an email from this mailbox immediately (actually delivers it). The signature is added automatically — pass just the message content in body. Default workflow is draft_email instead; only use this when explicitly asked to send right away. Not every mailbox has a send relay configured — see the error if not.",
      inputSchema: {
        to: z.string().describe("Recipient email address(es), comma-separated"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email message content (signature is appended automatically, do not include it)"),
        cc: z.string().optional().describe("CC recipient(s), comma-separated"),
        bcc: z.string().optional().describe("BCC recipient(s), comma-separated"),
        html: z.boolean().optional().describe("Set true if body is HTML, default false (plain text)"),
      },
    },
    async ({ to, subject, body, cc, bcc, html }) => {
      const result = await mail.sendEmail({ to, subject, body, cc, bcc, html: !!html });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "draft_email",
    {
      title: "Draft email",
      description:
        "Save a composed email to the Drafts folder for review — does NOT send it. The signature (with logo and images) is added automatically — pass just the message content in body. This is the default way to prepare an email; the mailbox owner reviews and sends it themselves.",
      inputSchema: {
        to: z.string().describe("Recipient email address(es), comma-separated"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email message content (signature is appended automatically, do not include it)"),
        cc: z.string().optional().describe("CC recipient(s), comma-separated"),
        bcc: z.string().optional().describe("BCC recipient(s), comma-separated"),
        html: z.boolean().optional().describe("Set true if body is HTML, default false (plain text)"),
      },
    },
    async ({ to, subject, body, cc, bcc, html }) => {
      const result = await mail.draftEmail({ to, subject, body, cc, bcc, html: !!html });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "list_contacts",
    {
      title: "List outreach contacts",
      description: "List this tenant's outreach contacts, optionally filtered by status.",
      inputSchema: { status: CONTACT_STATUS_ENUM.optional() },
    },
    async ({ status }) => {
      const contacts = await listContacts(tenant.id, { status });
      return { content: [{ type: "text", text: JSON.stringify(contacts, null, 2) }] };
    }
  );

  server.registerTool(
    "add_contacts",
    {
      title: "Add contacts",
      description:
        "Add or update one or more outreach contacts (matched by email). Existing contacts have name/industry updated but keep their current status and history.",
      inputSchema: {
        contacts: z
          .array(z.object({ name: z.string().optional(), email: z.string(), industry: z.string().optional() }))
          .min(1),
      },
    },
    async ({ contacts }) => {
      const result = await importContacts(tenant.id, contacts);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "update_contact_status",
    {
      title: "Update contact status",
      description:
        "Manually set a contact's status — e.g. mark someone 'opted_out' or 'unresponsive' to stop further outreach/reminders/drip for them.",
      inputSchema: { email: z.string(), status: CONTACT_STATUS_ENUM },
    },
    async ({ email, status }) => {
      const contact = await updateContactStatus(tenant.id, email, status);
      return { content: [{ type: "text", text: JSON.stringify(contact, null, 2) }] };
    }
  );

  server.registerTool(
    "draft_outreach_email",
    {
      title: "Draft outreach email to a contact",
      description:
        "Compose and save an outreach email to Drafts for a specific contact (added automatically if new). Records the message so replies are tracked and reminders/drip fire correctly against this contact. Does NOT send — same draft-first default as draft_email.",
      inputSchema: {
        to: z.string().describe("Contact's email address"),
        name: z.string().optional().describe("Contact's name, if new"),
        industry: z.string().optional().describe("Contact's industry/segment, if new"),
        subject: z.string(),
        body: z.string(),
        html: z.boolean().optional(),
      },
    },
    async ({ to, name, industry, subject, body, html }) => {
      const contact = await addContact(tenant.id, { name, email: to, industry });
      const result = await mail.draftEmail({ to, subject, body, html: !!html });
      await recordOutboundMessage(tenant.id, contact.id, { subject, messageId: result.messageId });
      return { content: [{ type: "text", text: JSON.stringify({ ...result, contact }, null, 2) }] };
    }
  );

  server.registerTool(
    "send_outreach_email",
    {
      title: "Send outreach email to a contact immediately",
      description:
        "Same as draft_outreach_email but actually sends right away. Only use when explicitly asked to send now rather than draft. Requires this tenant to have a send relay configured.",
      inputSchema: {
        to: z.string(),
        name: z.string().optional(),
        industry: z.string().optional(),
        subject: z.string(),
        body: z.string(),
        html: z.boolean().optional(),
      },
    },
    async ({ to, name, industry, subject, body, html }) => {
      const contact = await addContact(tenant.id, { name, email: to, industry });
      const result = await mail.sendEmail({ to, subject, body, html: !!html });
      await recordOutboundMessage(tenant.id, contact.id, { subject, messageId: result.messageId });
      return { content: [{ type: "text", text: JSON.stringify({ ...result, contact }, null, 2) }] };
    }
  );

  server.registerTool(
    "get_campaign_rules",
    {
      title: "Get campaign rules",
      description: "Read this tenant's current drip-campaign configuration (empty until set_campaign_rules is called).",
      inputSchema: {},
    },
    async () => {
      const rules = await getCampaignRules(tenant.id);
      return { content: [{ type: "text", text: JSON.stringify(rules, null, 2) }] };
    }
  );

  server.registerTool(
    "set_campaign_rules",
    {
      title: "Set campaign rules",
      description:
        "Configure this tenant's drip-campaign rules, e.g. { \"drip\": { \"cadenceDays\": 7, \"autoSend\": false, \"templates\": [{\"subject\": \"...\", \"body\": \"...\"}] } }. " +
        "Nothing drips until this is called with real templates — composition rules and cadence are never invented on this system's own initiative.",
      inputSchema: { rules: z.record(z.any()) },
    },
    async ({ rules }) => {
      await setCampaignRules(tenant.id, rules);
      return { content: [{ type: "text", text: "Campaign rules updated." }] };
    }
  );

  return server;
}

const app = express();
// Render sits in front of this app as a single reverse-proxy hop; trusting
// it lets express-rate-limit (used inside the SDK's OAuth routes) read the
// real client IP from X-Forwarded-For instead of rejecting the header.
app.set("trust proxy", 1);

app.get("/", (_req, res) => {
  res.status(200).send("Stacia Mail (multi-tenant) is running.");
});

app.use("/setup", buildSetupRouter({ getBaseUrl: () => BASE_URL }));

// Per-tenant OAuth Protected Resource Metadata (RFC 9728). One shared
// authorization server (mounted below) serves many resources — one per
// tenant's /t/:slug/mcp — so this can't be the single auto-generated
// metadata document mcpAuthRouter would build for one fixed resource; it's
// served dynamically instead, computed the same way
// getOAuthProtectedResourceMetadataUrl() expects to find it.
app.get("/.well-known/oauth-protected-resource/t/:slug/mcp", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const tenant = await getTenantBySlug(req.params.slug);
  if (!tenant) return res.status(404).json({ error: "unknown tenant" });
  res.status(200).json({
    resource: tenantResourceUrl(tenant.slug).href,
    authorization_servers: [BASE_URL.href],
    resource_name: tenant.displayName || tenant.slug,
  });
});
app.options("/.well-known/oauth-protected-resource/t/:slug/mcp", (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.status(204).end();
});

async function main() {
  await migrate();
  await bootstrapLegacyTenantFromEnv();
  const { provider, approveLogin } = await createOAuthProvider();

  // Mounts /authorize, /token, /register, /revoke, and
  // /.well-known/oauth-authorization-server — one shared authorization
  // server for every tenant. Per the SDK's own docs this router "MUST be
  // installed at the application root", which is why tenant identity flows
  // through the `resource` parameter instead of the URL path here.
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: BASE_URL,
      baseUrl: BASE_URL,
      resourceServerUrl: BASE_URL,
      resourceName: "Stacia Mail (multi-tenant)",
    })
  );

  // Handles the POST from the login form `provider.authorize()` renders.
  // Kept as its own top-level route (not nested under /authorize) so it
  // doesn't collide with the auth router's own method handling there.
  app.use(express.urlencoded({ extended: false }));
  app.post("/login", async (req, res) => {
    try {
      const result = await approveLogin(req.body || {});
      if (result.ok) {
        res.redirect(302, result.redirect);
      } else {
        res.status(401).type("html").send(result.html);
      }
    } catch (err) {
      console.error("Login error:", err);
      res.status(400).send("Invalid or expired authorization request. Please try connecting again from Claude.");
    }
  });

  app.use(express.json({ limit: "10mb" }));

  async function tenantResolver(req, res, next) {
    try {
      const tenant = await getTenantBySlug(req.params.slug);
      if (!tenant) return res.status(404).send(`Unknown tenant "${req.params.slug}".`);
      req.tenant = tenant;
      req.tenantResourceUrl = tenantResourceUrl(tenant.slug);
      next();
    } catch (err) {
      next(err);
    }
  }

  function tenantRequireAuth(req, res, next) {
    const requireAuth = requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(req.tenantResourceUrl),
    });
    requireAuth(req, res, next);
  }

  // requireBearerAuth verifies the token is valid but doesn't check *which*
  // resource it was minted for — with one shared authorization server that
  // has to be checked separately, or a token authorized for one tenant's
  // mailbox would work against any other tenant's /mcp endpoint too.
  function tenantAudienceCheck(req, res, next) {
    if (!req.auth?.resource || req.auth.resource.href !== req.tenantResourceUrl.href) {
      return res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "This token was not authorized for this tenant's mailbox." },
        id: null,
      });
    }
    next();
  }

  app.post("/t/:slug/mcp", tenantResolver, tenantRequireAuth, tenantAudienceCheck, async (req, res) => {
    try {
      const server = buildMcpServer(req.tenant);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error(`MCP request error for tenant "${req.tenant.slug}":`, err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.get("/t/:slug/mcp", tenantResolver, tenantRequireAuth, tenantAudienceCheck, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. This server is stateless (POST only)." },
      id: null,
    });
  });

  startBackgroundJobs();

  app.listen(PORT, () => {
    console.log(`Stacia Mail (multi-tenant) listening on port ${PORT}`);
    console.log(`OAuth issuer: ${BASE_URL.href}`);
    console.log(`Setup wizard: ${new URL("setup", BASE_URL).href}`);
  });
}

main().catch((err) => {
  console.error("FATAL startup error:", err);
  process.exit(1);
});
