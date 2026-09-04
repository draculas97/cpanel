import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { listFolders, listEmails, readEmail, sendEmail } from "./mailClient.js";
import { createOAuthProvider } from "./oauth.js";
 
const PORT = Number(process.env.PORT || 3000);
 
// This same value is both the legacy path-token (no longer used) and the
// passphrase you type into the one-time browser "Authorize" screen when
// Claude connects. Reusing MCP_TOKEN means no new env var is required for
// anyone who already deployed the earlier version of this server.
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || process.env.MCP_TOKEN;
if (!AUTH_PASSWORD) {
  console.error(
    "FATAL: set AUTH_PASSWORD (or MCP_TOKEN) — the passphrase used to approve the one-time browser login when Claude connects. Refusing to start."
  );
  process.exit(1);
}
 
// The public HTTPS URL this service is reachable at. Render sets
// RENDER_EXTERNAL_URL automatically; BASE_URL is there as an override/for
// other hosts.
const rawBaseUrl = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL;
if (!rawBaseUrl) {
  console.error(
    "FATAL: set BASE_URL to this service's public HTTPS URL (e.g. https://your-app.onrender.com). On Render this is normally set automatically via RENDER_EXTERNAL_URL. Refusing to start."
  );
  process.exit(1);
}
const BASE_URL = new URL(rawBaseUrl.replace(/\/+$/, "") + "/");
const RESOURCE_URL = new URL("mcp", BASE_URL);
 
const { provider, approveLogin } = createOAuthProvider({ authPassword: AUTH_PASSWORD });
 
function buildServer() {
  const server = new McpServer(
    { name: "cpanel-mail-mcp", version: "1.0.0" },
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
      const folders = await listFolders();
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
      const result = await listEmails({
        folder: folder || "INBOX",
        limit: limit || 20,
        unseenOnly: !!unseen_only,
      });
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
      const result = await readEmail({ uid, folder: folder || "INBOX" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
 
  server.registerTool(
    "send_email",
    {
      title: "Send email",
      description: "Send an email from this mailbox via SMTP.",
      inputSchema: {
        to: z.string().describe("Recipient email address(es), comma-separated"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body content"),
        cc: z.string().optional().describe("CC recipient(s), comma-separated"),
        bcc: z.string().optional().describe("BCC recipient(s), comma-separated"),
        html: z.boolean().optional().describe("Set true if body is HTML, default false (plain text)"),
      },
    },
    async ({ to, subject, body, cc, bcc, html }) => {
      const result = await sendEmail({ to, subject, body, cc, bcc, html: !!html });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
 
  return server;
}
 
const app = express();
// Render sits in front of this app as a single reverse-proxy hop; trusting
// it lets express-rate-limit (used inside the SDK's OAuth routes) read the
// real client IP from X-Forwarded-For instead of rejecting the header.
app.set("trust proxy", 1);
 
// Mounts /authorize, /token, /register, /revoke, and the
// /.well-known/oauth-authorization-server + /.well-known/oauth-protected-resource/mcp
// metadata endpoints Claude's connector uses to discover and register itself.
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: BASE_URL,
    baseUrl: BASE_URL,
    resourceServerUrl: RESOURCE_URL,
    resourceName: "Stacia Mail",
  })
);
 
// Handles the POST from the login form that provider.authorize() renders.
// Kept as its own top-level route (not nested under /authorize) so it
// doesn't collide with the auth router's own method handling there.
app.use(express.urlencoded({ extended: false }));
app.post("/login", (req, res) => {
  try {
    const result = approveLogin(req.body || {});
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
 
const requireAuth = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(RESOURCE_URL),
});
 
app.post("/mcp", requireAuth, async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});
 
app.get("/mcp", requireAuth, (req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This server is stateless (POST only)." },
    id: null,
  });
});
 
app.get("/", (req, res) => {
  res.status(200).send("cpanel-mail-mcp is running.");
});
 
app.listen(PORT, () => {
  console.log(`cpanel-mail-mcp listening on port ${PORT}`);
  console.log(`OAuth issuer: ${BASE_URL.href}`);
  console.log(`MCP endpoint: ${RESOURCE_URL.href}`);
});
