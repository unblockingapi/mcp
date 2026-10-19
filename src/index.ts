#!/usr/bin/env node
/**
 * UnblockingAPI MCP server, stdio entry.
 *
 * Exposes UnblockingAPI's web-unblocking capabilities as MCP tools so AI agents
 * can fetch bot-protected / JS-heavy pages and parse them into structured JSON
 * with any published template. The hosted variant at mcp.unblockingapi.com is
 * http.ts; both serve the tools in server.ts.
 *
 * Transport: stdio. Config via environment:
 *   UNBLOCKINGAPI_KEY        (required)  your API key
 *   UNBLOCKINGAPI_BASE_URL   (optional)  override base URL (default https://api.unblockingapi.com)
 *   UNBLOCKINGAPI_TIMEOUT_MS (optional)  request timeout in ms (default 180000)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { UnblockingApiClient, missingKeyMessage } from "./client.js";
import { VERSION, createServer } from "./server.js";

export { VERSION, createServer, looksLikeItNeedsJs, templateMatchesUrl } from "./server.js";

/**
 * The key comes from UNBLOCKINGAPI_KEY, or — inside the Claude Code plugin —
 * from the plugin's user config. A value that still looks like an unexpanded
 * `${…}` placeholder (config the host could not resolve) counts as unset.
 */
function resolveApiKey(): string {
  for (const candidate of [
    process.env.UNBLOCKINGAPI_KEY,
    process.env.UNBLOCKINGAPI_KEY_ENV,
    process.env.CLAUDE_PLUGIN_OPTION_API_KEY,
    process.env.CLAUDE_PLUGIN_OPTION_api_key,
  ]) {
    const value = candidate?.trim() ?? "";
    if (value && !value.startsWith("${")) return value;
  }
  return "";
}

const apiKey = resolveApiKey();
const baseUrl = process.env.UNBLOCKINGAPI_BASE_URL || undefined;
const timeoutMs = process.env.UNBLOCKINGAPI_TIMEOUT_MS
  ? Number(process.env.UNBLOCKINGAPI_TIMEOUT_MS)
  : undefined;

export const server = createServer(new UnblockingApiClient({ apiKey, baseUrl, timeoutMs }));

async function main() {
  if (!apiKey) {
    // Surface a clear message on stderr; the server still starts so the host can
    // show the tool list, but every fetch will fail fast with a clear error.
    process.stderr.write(`[unblockingapi-mcp] WARNING: ${missingKeyMessage()}\n`);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[unblockingapi-mcp] v${VERSION} started (stdio)\n`);
}

main().catch((err) => {
  process.stderr.write(`[unblockingapi-mcp] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
