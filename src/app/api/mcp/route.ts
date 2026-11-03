import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { callTwinTool, TWIN_TOOLS } from "@/domain/tools/twin-tools";
import { safeEqual } from "@/server/admin";
import { setting } from "@/server/settings";
import { serverToolStore } from "@/server/tools/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Twin as an MCP server (Streamable HTTP, stateless, JSON responses).
 * Any MCP client (the Python Muse Spark agent, Claude Code, an IDE) can use the same deterministic
 * tools as the built-in copilot. Read tools are marked read-only; `propose_plan` only creates a
 * pending recommendation that a person must approve in the app.
 * Optional auth: set an access token (Integrations → MCP server, or TWIN_MCP_TOKEN) and send
 * `Authorization: Bearer <token>`. The endpoint can also be turned off there.
 */
function buildServer() {
  const server = new McpServer({ name: "twin", version: "1.0.0" }, { instructions: "Tools for the Twin industrial digital twin. All figures come from a deterministic plant model with simulated demo data. Plans can be proposed for human approval; nothing executes on equipment." });
  for (const t of TWIN_TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.shape,
        annotations: { readOnlyHint: t.effect === "read", destructiveHint: false, idempotentHint: t.effect === "read", openWorldHint: false },
      },
      async (args: unknown) => {
        try {
          const result = callTwinTool(serverToolStore, t.name, args, "MCP client");
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
        }
      },
    );
  }
  return server;
}

async function handle(req: Request) {
  if (setting("TWIN_MCP_ENABLED") === "false") {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "The MCP endpoint is turned off in Integrations." }, id: null }), { status: 503, headers: { "content-type": "application/json" } });
  }
  const token = setting("TWIN_MCP_TOKEN");
  if (token && !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${token}`)) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
