import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { listFolders, listEmails, readEmail, sendEmail } from "./mailClient.js";

const PORT = Number(process.env.PORT || 3000);
const MCP_TOKEN = process.env.MCP_TOKEN;
if (!MCP_TOKEN) {
  console.error("FATAL: MCP_TOKEN environment variable is not set. Refusing to start.");
  process.exit(1);
}

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
app.use(express.json({ limit: "10mb" }));

function checkAuth(req, res) {
  if (req.params.token !== MCP_TOKEN) {
    res.status(404).end();
    return false;
  }
  return true;
}

app.post("/mcp/:token", async (req, res) => {
  if (!checkAuth(req, res)) return;
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

app.get("/mcp/:token", (req, res) => {
  if (!checkAuth(req, res)) return;
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
});
