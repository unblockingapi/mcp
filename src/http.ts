#!/usr/bin/env node
/**
 * UnblockingAPI MCP server, hosted entry (https://mcp.unblockingapi.com/mcp).
 *
 * Streamable HTTP, stateless: every POST builds a fresh McpServer bound to the
 * caller's own API key, so nothing is shared between requests and any replica
 * can answer any request (no sessions, no sticky routing). Replies stream as
 * SSE: the headers go out at once and the SDK writes a keepalive comment every
 * 15s, which keeps a 2-minute render alive through Cloudflare (100s to first
 * byte) and Traefik.
 *
 * The key arrives as `Authorization: Bearer <key>` or `X-Api-Key: <key>` and is
 * forwarded to api.unblockingapi.com unchanged; credits, plans and concurrency
 * stay the API's business. It is never logged.
 *
 * Config via environment:
 *   PORT                     (optional)  listen port (default 8080)
 *   UNBLOCKINGAPI_BASE_URL   (optional)  API base URL (default https://api.unblockingapi.com)
 *   UNBLOCKINGAPI_TIMEOUT_MS (optional)  per-request API timeout in ms (default 180000)
 *   SHUTDOWN_GRACE_MS        (optional)  how long SIGTERM waits for in-flight calls (default 185000)
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { UnblockingApiClient } from "./client.js";
import { VERSION, createServer } from "./server.js";

const port = Number(process.env.PORT || 8080);
const baseUrl = process.env.UNBLOCKINGAPI_BASE_URL || undefined;
const timeoutMs = process.env.UNBLOCKINGAPI_TIMEOUT_MS ? Number(process.env.UNBLOCKINGAPI_TIMEOUT_MS) : undefined;
// Above the client's 180s worst case, so a deploy never cuts a render short.
const shutdownGraceMs = Number(process.env.SHUTDOWN_GRACE_MS || 185_000);

/** A JSON-RPC request body is a few KB; anything near this is not a client. */
const MAX_BODY_BYTES = 1_000_000;

const DOCS_URL = "https://github.com/unblockingapi/mcp#hosted-server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-Api-Key, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

export function extractApiKey(req: IncomingMessage): string {
  const auth = req.headers.authorization ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  const header = req.headers["x-api-key"];
  return bearer || (Array.isArray(header) ? header[0] : header)?.trim() || "";
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
    ...CORS_HEADERS,
    ...headers,
  });
  res.end(text);
}

function rpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}) {
  send(res, status, { jsonrpc: "2.0", error: { code, message }, id: null }, headers);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RangeError("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** What the request asked for, for the access log: `tools/call:unblock_fetch`, `initialize`, … */
function describe(body: unknown): string {
  const messages = Array.isArray(body) ? body : [body];
  return messages
    .map((m) => {
      const msg = m as { method?: string; params?: { name?: string } };
      if (!msg?.method) return "response";
      return msg.method === "tools/call" && msg.params?.name ? `tools/call:${msg.params.name}` : msg.method;
    })
    .join(",");
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<string> {
  if (req.method !== "POST") {
    // Stateless: no standalone SSE stream to GET and no session to DELETE.
    rpcError(res, 405, -32000, "Method not allowed: this server is stateless, POST JSON-RPC to /mcp.", { Allow: "POST, OPTIONS" });
    return "-";
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    rpcError(
      res,
      401,
      -32001,
      `Missing API key. Send "Authorization: Bearer <your UnblockingAPI key>". Get a key with 500 free credits at https://unblockingapi.com — setup: ${DOCS_URL}`,
      { "WWW-Authenticate": 'Bearer realm="UnblockingAPI"' },
    );
    return "-";
  }

  let body: unknown;
  try {
    body = await readJson(req);
  } catch (err) {
    if (err instanceof RangeError) rpcError(res, 413, -32600, "Request body too large.");
    else rpcError(res, 400, -32700, "Parse error: the body must be JSON-RPC.");
    return "-";
  }

  const server = createServer(new UnblockingApiClient({ apiKey, baseUrl, timeoutMs }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
  return describe(body);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const started = Date.now();
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  let what = "-";

  res.on("finish", () => {
    if (path === "/healthz") return;
    process.stdout.write(`${req.method} ${path} ${what} ${res.statusCode} ${Date.now() - started}ms\n`);
  });

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
    } else if (path === "/healthz") {
      send(res, shuttingDown ? 503 : 200, shuttingDown ? "shutting down" : "ok");
    } else if (path === "/mcp" || path === "/mcp/") {
      what = await handleMcp(req, res);
    } else if (path === "/" && req.method === "GET") {
      send(
        res,
        200,
        `UnblockingAPI MCP server v${VERSION}\n\n` +
          `Endpoint: https://mcp.unblockingapi.com/mcp (Streamable HTTP)\n` +
          `Auth:     Authorization: Bearer <your UnblockingAPI key>\n` +
          `Setup:    ${DOCS_URL}\n`,
      );
    } else {
      send(res, 404, "Not found. The MCP endpoint is /mcp.");
    }
  } catch (err) {
    process.stderr.write(`[unblockingapi-mcp] ${req.method} ${path} failed: ${(err as Error).stack ?? err}\n`);
    if (!res.headersSent) rpcError(res, 500, -32603, "Internal server error.");
    else res.end();
  }
}

let shuttingDown = false;

const httpServer = createHttpServer((req, res) => void route(req, res));
// Longer than Traefik's 90s idle timeout towards backends: if Node closed an
// idle keep-alive connection first, Traefik could reuse it mid-close and 502.
httpServer.keepAliveTimeout = 95_000;
httpServer.headersTimeout = 96_000;
// The response is a stream that may legitimately run for minutes.
httpServer.requestTimeout = 0;

httpServer.listen(port, () => {
  process.stdout.write(`[unblockingapi-mcp] v${VERSION} listening on :${port} (streamable http)\n`);
});

process.on("SIGTERM", () => {
  // Fail readiness, stop accepting, let in-flight tool calls finish.
  shuttingDown = true;
  httpServer.close(() => process.exit(0));
  httpServer.closeIdleConnections();
  setTimeout(() => process.exit(0), shutdownGraceMs).unref();
});
