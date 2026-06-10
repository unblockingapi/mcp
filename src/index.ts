#!/usr/bin/env node
/**
 * UnblockingAPI MCP server.
 *
 * Exposes UnblockingAPI's web-unblocking and SERP capabilities as MCP tools so
 * AI agents can fetch bot-protected / JS-heavy pages and run structured searches.
 *
 * Transport: stdio. Config via environment:
 *   UNBLOCKINGAPI_KEY        (required)  your API key
 *   UNBLOCKINGAPI_BASE_URL   (optional)  override base URL (default https://api.unblockingapi.com)
 *   UNBLOCKINGAPI_TIMEOUT_MS (optional)  request timeout in ms (default 70000)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { UnblockingApiClient, UnblockingApiError, type ApiResult } from "./client.js";

const apiKey = process.env.UNBLOCKINGAPI_KEY ?? "";
const baseUrl = process.env.UNBLOCKINGAPI_BASE_URL || undefined;
const timeoutMs = process.env.UNBLOCKINGAPI_TIMEOUT_MS
  ? Number(process.env.UNBLOCKINGAPI_TIMEOUT_MS)
  : undefined;

const client = new UnblockingApiClient({ apiKey, baseUrl, timeoutMs });

const server = new McpServer({
  name: "unblockingapi",
  version: "0.2.0",
});

/** Render an ApiResult into MCP tool output, marking failures with isError. */
function toToolResult(result: ApiResult) {
  const failed = result.status === "failed";
  const meta = {
    job_id: result.job_id,
    url: result.url,
    status: result.status,
    http_response_code: result.http_response_code,
    response_time_ms: result.response_time_ms,
    location: result.location,
    render: result.render,
    ...(result.api_name ? { api_name: result.api_name } : {}),
    ...(result.error ? { error: result.error } : {}),
  };

  const body =
    result.response_format === "json"
      ? JSON.stringify(result.response ?? null, null, 2)
      : typeof result.response === "string"
        ? result.response
        : "";

  const text = failed
    ? `Request failed: ${result.error ?? "unknown error"}\n\n${JSON.stringify(meta, null, 2)}`
    : `${JSON.stringify(meta, null, 2)}\n\n---\n\n${body}`;

  return {
    isError: failed,
    content: [{ type: "text" as const, text }],
  };
}

/** Wrap a tool handler so client/network errors become clean MCP error results. */
async function safe(fn: () => Promise<ApiResult>) {
  try {
    return toToolResult(await fn());
  } catch (err) {
    const message =
      err instanceof UnblockingApiError
        ? err.message
        : `Unexpected error: ${(err as Error).message}`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: message }],
    };
  }
}

// --- Tool: unblock_fetch -----------------------------------------------------
server.tool(
  "unblock_fetch",
  "Fetch a URL through UnblockingAPI, bypassing bot detection, CAPTCHAs, and geo-blocks " +
    "with rotating residential proxies. Returns the page HTML. Set render=true for " +
    "JavaScript-heavy sites (SPAs, dynamic content) to get the fully rendered DOM.",
  {
    url: z.string().url().describe("The HTTP/HTTPS URL to fetch."),
    render: z
      .boolean()
      .optional()
      .describe(
        "Render with a headless browser (executes JavaScript). Required for SPAs and dynamic pages. Default false (fast plain-HTTP fetch).",
      ),
    location: z
      .string()
      .length(2)
      .optional()
      .describe("2-letter country code to proxy through (e.g. 'us', 'gb', 'de')."),
    wait: z
      .string()
      .optional()
      .describe(
        "Render-only. Comma-separated wait steps (max 5): an optional leading load event " +
          "(domcontentloaded|load|networkidle), then CSS selectors to wait for, or " +
          "'networkidle:<ms>' / 'domstable:<ms>' quiet-poll strategies. e.g. 'domcontentloaded,h3'.",
      ),
    block_assets: z
      .boolean()
      .optional()
      .describe(
        "Render-only. When rendering, presentational assets (CSS, images, fonts, media) are " +
          "skipped by DEFAULT for speed — JavaScript still executes, so SPAs and dynamic content " +
          "still render fully. Set block_assets=false to also download CSS/images/fonts (e.g. when " +
          "you need asset URLs or a visually complete render). Ignored when render=false.",
      ),
    remove_scripts: z
      .boolean()
      .optional()
      .describe("Strip <script> tags from the returned HTML."),
    remove_stylesheets: z
      .boolean()
      .optional()
      .describe("Strip <style> tags from the returned HTML."),
    remove_svgs: z.boolean().optional().describe("Strip <svg> tags from the returned HTML."),
  },
  async (args) => safe(() => client.unblock(args)),
);

// --- Tool: google_search -----------------------------------------------------
server.tool(
  "google_search",
  "Run a Google search through UnblockingAPI and get structured organic results as JSON. " +
    "Useful for SERP data, research, and competitive analysis without getting blocked.",
  {
    q: z.string().describe("The search query / keyword."),
    location: z
      .string()
      .length(2)
      .optional()
      .describe("2-letter country code for the search locale (default 'se')."),
    uule: z
      .string()
      .optional()
      .describe("Optional Google UULE location-encoding string for precise geo-targeting."),
    start: z
      .number()
      .int()
      .optional()
      .describe("Result offset for pagination (0 = page 1, 10 = page 2, …)."),
  },
  async (args) => safe(() => client.template("google-search", args)),
);

// --- Tool: idealista_property ------------------------------------------------
server.tool(
  "idealista_property",
  "Extract structured data from an idealista.com property listing (Spain's largest " +
    "real-estate portal) — price, size, rooms, bathrooms, floor, energy rating, " +
    "features, photos, advertiser, and more, as JSON. Pass the full listing URL.",
  {
    url: z
      .string()
      .url()
      .describe(
        "Full idealista.com listing URL, e.g. https://www.idealista.com/inmueble/111072490/",
      ),
  },
  async (args) => safe(() => client.template("idealista-property", args)),
);

// NOTE: an `ahrefs-website-authority` template exists in the API but is currently
// disabled server-side (the Ahrefs render flow isn't reliable yet), so it is not
// exposed as a tool here. Re-add it once the template is enabled in production.

async function main() {
  if (!apiKey) {
    // Surface a clear message on stderr; the server still starts so the host can
    // show the tool list, but every call will fail fast with a 401-style error.
    process.stderr.write(
      "[unblockingapi-mcp] WARNING: UNBLOCKINGAPI_KEY is not set — all requests will fail.\n",
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[unblockingapi-mcp] server started (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`[unblockingapi-mcp] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
