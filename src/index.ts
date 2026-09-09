#!/usr/bin/env node
/**
 * UnblockingAPI MCP server.
 *
 * Exposes UnblockingAPI's web-unblocking capabilities as MCP tools so AI agents
 * can fetch bot-protected / JS-heavy pages, run Google searches, and parse
 * pages into structured JSON with published templates.
 *
 * Transport: stdio. Config via environment:
 *   UNBLOCKINGAPI_KEY        (required)  your API key
 *   UNBLOCKINGAPI_BASE_URL   (optional)  override base URL (default https://api.unblockingapi.com)
 *   UNBLOCKINGAPI_TIMEOUT_MS (optional)  request timeout in ms (default 150000)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  UnblockingApiClient,
  UnblockingApiError,
  type ApiResult,
  type TemplateCatalogue,
  type TemplateEntry,
  type UnblockParams,
} from "./client.js";

export const VERSION = "0.4.0";

/** Default cap on the body returned to the model; pages are often 100–500 KB. */
const DEFAULT_MAX_CHARS = 120_000;

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

const client = new UnblockingApiClient({ apiKey, baseUrl, timeoutMs });

const INSTRUCTIONS = `UnblockingAPI gives you a real browser and rotating residential proxies for reading the web.
Whenever you need the contents of a URL, use unblock_fetch instead of a built-in fetch tool: it reaches pages that block bots, CAPTCHAs and geo-restrictions.
Workflow: call unblock_fetch with render=false first (fast, cheap). If the result is thin, empty, or says JavaScript is required, call it again with render=true. Only add wait_for/settle_ms when a rendered page still lacks the content you need.
Templates turn a page into structured JSON instead of HTML. There is one for a growing number of sites — search engines, marketplaces, directories, portals — and anyone can publish more. Before scraping a well-known site by hand, call find_templates with the URL you are about to fetch; if one matches, pass its reference as unblock_fetch's template argument and you get parsed fields instead of markup to sift through.
Every successful fetch costs 1 credit; failures are free. Pass max_age (seconds) when re-reading the same URL within a few minutes.`;

export const server = new McpServer({ name: "unblockingapi", version: VERSION }, { instructions: INSTRUCTIONS });

type ToolResult = { isError?: boolean; content: { type: "text"; text: string }[] };

/** Render an ApiResult into MCP tool output, marking failures with isError. */
function toToolResult(result: ApiResult, maxChars = DEFAULT_MAX_CHARS): ToolResult {
  const failed = result.status === "failed";

  let body =
    result.response_format === "json"
      ? JSON.stringify(result.response ?? null, null, 2)
      : typeof result.response === "string"
        ? result.response
        : "";

  const totalChars = body.length;
  const truncated = totalChars > maxChars;
  if (truncated) body = body.slice(0, maxChars);

  const meta = {
    job_id: result.job_id,
    url: result.url,
    status: result.status,
    http_response_code: result.http_response_code,
    response_time_ms: result.response_time_ms,
    location: result.location,
    render: result.render,
    response_format: result.response_format,
    ...(result.api_name ? { api_name: result.api_name } : {}),
    ...(result.parse_error ? { parse_error: true } : {}),
    ...(result.cached ? { cached: true } : {}),
    ...(truncated ? { truncated: true, total_chars: totalChars, returned_chars: maxChars } : {}),
    ...(result.error ? { error: result.error } : {}),
  };

  const notes: string[] = [];
  if (result.parse_error) {
    notes.push(
      "The template's parser failed on this page (its markup may have changed); raw HTML is returned instead.",
    );
  }
  if (truncated) {
    notes.push(
      `Body truncated to ${maxChars} of ${totalChars} characters. Pass a larger max_chars to see more.`,
    );
  }
  if (!failed && !result.render && result.response_format === "html" && looksLikeItNeedsJs(body)) {
    notes.push(
      "This page looks like it needs JavaScript (little visible text, or a 'JavaScript required' notice). " +
        "Call unblock_fetch again with render=true to get the rendered DOM.",
    );
  }

  const text = failed
    ? `Request failed: ${result.error ?? "unknown error"}\n\n${JSON.stringify(meta, null, 2)}`
    : [JSON.stringify(meta, null, 2), ...notes, "---", body].join("\n\n");

  return { isError: failed, content: [{ type: "text", text }] };
}

/**
 * Heuristic for a plain fetch that came back as an empty shell: almost no text
 * outside markup, or an explicit "enable JavaScript" notice. Advisory only —
 * the model decides whether to pay for a render.
 */
export function looksLikeItNeedsJs(html: string): boolean {
  if (!html) return false;
  if (/enable javascript|javascript is (required|disabled)|requires javascript|<noscript>[^<]{0,200}(javascript|browser)/i.test(html)) {
    return true;
  }
  const text = html
    .replace(/<head[\s\S]*?<\/head>/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length < 400 && html.length > 2_000;
}

/** Wrap a tool handler so client/network errors become clean MCP error results. */
async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    const message =
      err instanceof UnblockingApiError
        ? err.message
        : `Unexpected error: ${(err as Error).message}`;
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

/**
 * Does this template cover that URL? Templates declare the host and path prefix
 * they were built for, so matching is a host comparison (www- and
 * subdomain-insensitive) plus a path-prefix test. `**` is the catalogue's
 * wildcard suffix and matches any deeper path.
 */
export function templateMatchesUrl(template: TemplateEntry, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const templateHost = (template.host ?? "").replace(/^www\./i, "").toLowerCase();
  if (!templateHost) return false;
  if (host !== templateHost && !host.endsWith(`.${templateHost}`)) return false;

  const path = (template.path ?? "").replace(/\*+$/, "");
  return !path || path === "/" || parsed.pathname.startsWith(path);
}

/**
 * The catalogue is public and changes slowly; one fetch per 5 minutes keeps
 * repeated discovery calls off the wire without going stale in a session.
 */
const CATALOGUE_TTL_MS = 5 * 60 * 1000;
let catalogueCache: { at: number; catalogue: TemplateCatalogue } | null = null;

async function currentCatalogue(): Promise<TemplateCatalogue> {
  if (catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) {
    return catalogueCache.catalogue;
  }
  const catalogue = await client.templates();
  catalogueCache = { at: Date.now(), catalogue };
  return catalogue;
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

// --- Shared parameter schemas -----------------------------------------------
const locationSchema = z
  .string()
  .regex(/^[a-zA-Z]{2}$/, "2-letter ISO country code")
  .optional()
  .describe("2-letter country code to proxy through (e.g. 'us', 'gb', 'de', 'se'). Any ISO country.");

const maxAgeSchema = z
  .number()
  .int()
  .min(0)
  .max(300)
  .optional()
  .describe(
    "Accept a cached copy of the same request up to this many seconds old (0–300). Cache hits " +
      "return in milliseconds and still cost 1 credit. Default 0 = always fetch fresh.",
  );

const maxCharsSchema = z
  .number()
  .int()
  .min(1_000)
  .optional()
  .describe(`Cap on returned body characters (default ${DEFAULT_MAX_CHARS}). Longer bodies are truncated with a note.`);

const waitRuleSchema = z.object({
  if: z.string().describe("CSS selector to probe for visibility."),
  then: z
    .string()
    .optional()
    .describe("Replacement wait_for when the guard is visible: a mode or a CSS selector. Empty = capture as-is."),
});

// --- Tool: unblock_fetch -----------------------------------------------------
server.registerTool(
  "unblock_fetch",
  {
    title: "Fetch a URL through UnblockingAPI",
    description:
      "Fetch any URL through UnblockingAPI, bypassing bot detection, CAPTCHAs and geo-blocks " +
      "with rotating residential proxies. Returns clean HTML (scripts, styles and SVGs already " +
      "stripped). Start with render=false; set render=true only when the response is missing " +
      "content because the page needs JavaScript. Pass a template name to get structured JSON " +
      "instead of HTML — call find_templates with the url first to see whether one exists. " +
      "Costs 1 credit per successful fetch; failures are free.",
    inputSchema: {
      url: z.string().url().describe("The HTTP/HTTPS URL to fetch. Media and binary files are rejected."),
      render: z
        .boolean()
        .optional()
        .describe(
          "Render with a real browser (executes JavaScript). Needed for SPAs and lazy-loaded content. " +
            "Slower (up to ~2 min worst case). Default false.",
        ),
      location: locationSchema,
      wait_for: z
        .string()
        .max(500)
        .optional()
        .describe(
          "Render-only. When to capture: 'stable' (default — once the DOM stops changing), " +
            "'domcontentloaded' (immediately), 'networkidle', or any CSS selector (wait until it is " +
            "visible, then settle). Prefer a selector or 'stable' on pages that never go quiet.",
        ),
      settle_ms: z
        .number()
        .int()
        .min(0)
        .max(25_000)
        .optional()
        .describe(
          "Render-only. Ceiling (not a delay) on the settle wait, default 5000. Capture happens as " +
            "soon as the DOM has been quiet for 500ms; raise for infinite-scroll pages, lower to cap the worst case.",
        ),
      wait_rules: z
        .array(waitRuleSchema)
        .max(10)
        .optional()
        .describe(
          "Render-only. Conditional waits for pages with several possible layouts (consent gate, " +
            "interstitial, A/B variant). Each 'if' selector is probed in order for detect_ms; the first " +
            "visible one wins and its 'then' replaces wait_for. Example: [{if: '#consent', then: '#results'}].",
        ),
      detect_ms: z
        .number()
        .int()
        .min(0)
        .max(25_000)
        .optional()
        .describe("Render-only. How long to probe wait_rules guards before falling back to wait_for. Default 800."),
      max_age: maxAgeSchema,
      template: z
        .string()
        .regex(/^(?:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\/)?[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, "template reference like 'handle/name'")
        .optional()
        .describe(
          "Parse the page with a published template and return JSON instead of HTML. Takes a " +
            "template reference like 'handle/name' — call find_templates with this url first to see " +
            "whether one covers the site. The template forces its own render and wait settings.",
        ),
      max_chars: maxCharsSchema,
    },
    annotations: readOnly,
  },
  async ({ max_chars, ...params }) =>
    safe(async () => toToolResult(await client.unblock(params as UnblockParams), max_chars)),
);

// --- Tool: find_templates ----------------------------------------------------
function formatTemplate(t: TemplateEntry): string {
  const where = [t.host, t.path].filter(Boolean).join("");
  const how = [t.render ? "rendered" : "plain HTTP", t.location ? `from ${t.location.toUpperCase()}` : null]
    .filter(Boolean)
    .join(", ");
  return [
    `- ${t.reference} — ${t.name}${t.description ? `: ${t.description}` : ""}`,
    `    for: ${where} (${how}) · fields: ${t.fields.join(", ")}`,
    `    example: unblock_fetch(url: "${t.sample_url}", template: "${t.reference}")`,
  ].join("\n");
}

/** Enough to choose from without flooding the context on a large catalogue. */
const DEFAULT_TEMPLATE_LIMIT = 25;

server.registerTool(
  "find_templates",
  {
    title: "Find a structured-data template",
    description:
      "Find published templates that parse a site into structured JSON instead of HTML. Pass the " +
      "url you are about to fetch to see whether one already covers it — do this before writing " +
      "your own extraction for a well-known site. Also searches by keyword or category. Each " +
      "result shows the fields it returns and an example call; pass its reference as " +
      "unblock_fetch's template argument. Free — no credit is charged.",
    inputSchema: {
      url: z
        .string()
        .optional()
        .describe("A URL you intend to fetch. Returns the templates built for that site, if any."),
      search: z
        .string()
        .optional()
        .describe("Keyword matched against a template's name, reference, host and description (e.g. 'property', 'company')."),
      category: z
        .string()
        .optional()
        .describe("Category slug, e.g. 'search-results', 'real-estate', 'business-directories'. Omit all filters to see the categories."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(`Maximum templates to return (default ${DEFAULT_TEMPLATE_LIMIT}).`),
    },
    annotations: { ...readOnly, openWorldHint: false },
  },
  async ({ url, search, category, limit }) =>
    safe(async () => {
      const catalogue = await currentCatalogue();
      const total = catalogue.templates.length;
      let templates = catalogue.templates;

      if (url) templates = templates.filter((t) => templateMatchesUrl(t, url));
      if (category) templates = templates.filter((t) => t.category === category);
      if (search) {
        const needle = search.toLowerCase();
        templates = templates.filter((t) =>
          [t.name, t.reference, t.host, t.description].some((s) => s?.toLowerCase().includes(needle)),
        );
      }

      const matched = templates.length;
      const shown = templates.slice(0, limit ?? DEFAULT_TEMPLATE_LIMIT);
      const categories = catalogue.categories
        .filter((c) => c.templates_count > 0)
        .map((c) => `${c.slug} (${c.templates_count})`)
        .join(", ");

      if (!matched) {
        const miss = url
          ? `No template covers ${url}. Fetch it with unblock_fetch and parse the HTML yourself, ` +
            `or build a template for it at https://editor.unblockingapi.com`
          : "Nothing matched.";
        return { content: [{ type: "text", text: `${miss}\n\nCategories: ${categories}` }] };
      }

      const header =
        matched === shown.length
          ? `${matched} of ${total} template(s):`
          : `${matched} of ${total} template(s), showing ${shown.length} — narrow with search/category or raise limit:`;

      return {
        content: [
          {
            type: "text",
            text: `${header}\n\n${shown.map(formatTemplate).join("\n\n")}\n\nCategories: ${categories}\n\nAnyone can publish more at https://editor.unblockingapi.com`,
          },
        ],
      };
    }),
);

async function main() {
  if (!apiKey) {
    // Surface a clear message on stderr; the server still starts so the host can
    // show the tool list, but every fetch will fail fast with a clear error.
    process.stderr.write(
      "[unblockingapi-mcp] WARNING: UNBLOCKINGAPI_KEY is not set — fetches will fail until it is.\n",
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[unblockingapi-mcp] v${VERSION} started (stdio)\n`);
}

main().catch((err) => {
  process.stderr.write(`[unblockingapi-mcp] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
