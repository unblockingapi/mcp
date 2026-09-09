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
  type TemplateEntry,
  type UnblockParams,
} from "./client.js";

export const VERSION = "0.3.0";

/**
 * The published template that parses a Google results page. Official (bare-slug)
 * templates do not exist yet, so this names the community one. Override with
 * UNBLOCKINGAPI_GOOGLE_TEMPLATE if you fork it in the editor.
 */
const GOOGLE_TEMPLATE = process.env.UNBLOCKINGAPI_GOOGLE_TEMPLATE || "kjellberg/google-search";

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
For Google results use google_search. For sites with a published template (see list_templates) pass template=<name> to get structured JSON instead of HTML.
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
      "instead of HTML (see list_templates). Costs 1 credit per successful fetch; failures are free.",
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
          "Parse the page with a published template and return JSON instead of HTML, e.g. " +
            "'kjellberg/google-search'. The template forces its own render/wait settings. Use list_templates to discover names.",
        ),
      max_chars: maxCharsSchema,
    },
    annotations: readOnly,
  },
  async ({ max_chars, ...params }) =>
    safe(async () => toToolResult(await client.unblock(params as UnblockParams), max_chars)),
);

// --- Tool: google_search -----------------------------------------------------
server.registerTool(
  "google_search",
  {
    title: "Google search (structured results)",
    description:
      "Run a Google search through UnblockingAPI and get structured JSON: the query, organic " +
      "results (position, title, description, url) and related searches. Uses a browser render " +
      `plus the '${GOOGLE_TEMPLATE}' template; if the template is unavailable the raw results ` +
      "page HTML is returned instead. Costs 1 credit per search.",
    inputSchema: {
      q: z.string().min(1).describe("The search query."),
      location: z
        .string()
        .regex(/^[a-zA-Z]{2}$/, "2-letter ISO country code")
        .optional()
        .describe("2-letter country code: proxies from that country and sets Google's gl= parameter (e.g. 'us', 'gb', 'se')."),
      language: z
        .string()
        .regex(/^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/, "language code like 'en' or 'pt-BR'")
        .optional()
        .describe("Interface language for Google's hl= parameter (e.g. 'en', 'de')."),
      start: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Result offset for pagination (0 = page 1, 10 = page 2, …)."),
      max_age: maxAgeSchema,
    },
    annotations: readOnly,
  },
  async ({ q, location, language, start, max_age }) =>
    safe(async () => {
      const url = new URL("https://www.google.com/search");
      url.searchParams.set("q", q);
      if (location) url.searchParams.set("gl", location.toLowerCase());
      if (language) url.searchParams.set("hl", language);
      if (start) url.searchParams.set("start", String(start));

      const base: UnblockParams = { url: url.toString(), location: location?.toLowerCase(), max_age };
      try {
        return toToolResult(await client.unblock({ ...base, template: GOOGLE_TEMPLATE }));
      } catch (err) {
        // The community template was renamed or unpublished: still deliver the page.
        if (err instanceof UnblockingApiError && err.status === 404) {
          const result = await client.unblock({ ...base, render: true });
          const out = toToolResult(result);
          out.content[0].text =
            `Note: template '${GOOGLE_TEMPLATE}' was not found, returning the raw results page instead.\n\n` +
            out.content[0].text;
          return out;
        }
        throw err;
      }
    }),
);

// --- Tool: list_templates ----------------------------------------------------
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

server.registerTool(
  "list_templates",
  {
    title: "List structured-data templates",
    description:
      "List the published UnblockingAPI templates that parse specific sites into structured JSON " +
      "(search engines, property portals, business directories, …). Each entry shows the site it " +
      "is built for, the fields it returns, and an example call. Use a template's reference as the " +
      "'template' argument of unblock_fetch. Free — no credit is charged.",
    inputSchema: {
      category: z
        .string()
        .optional()
        .describe("Filter by category slug, e.g. 'search-results', 'real-estate', 'business-directories'."),
      search: z
        .string()
        .optional()
        .describe("Case-insensitive match against the template's name, reference, host or description."),
    },
    annotations: { ...readOnly, openWorldHint: false },
  },
  async ({ category, search }) =>
    safe(async () => {
      const catalogue = await client.templates();
      let templates = catalogue.templates;
      if (category) templates = templates.filter((t) => t.category === category);
      if (search) {
        const needle = search.toLowerCase();
        templates = templates.filter((t) =>
          [t.name, t.reference, t.host, t.description].some((s) => s?.toLowerCase().includes(needle)),
        );
      }

      const categories = catalogue.categories
        .filter((c) => c.templates_count > 0)
        .map((c) => `${c.slug} (${c.templates_count})`)
        .join(", ");

      const text = templates.length
        ? `${templates.length} template(s):\n\n${templates.map(formatTemplate).join("\n\n")}\n\nCategories: ${categories}\n\nAnyone can build more at https://editor.unblockingapi.com`
        : `No templates match. Categories with templates: ${categories}`;

      return { content: [{ type: "text", text }] };
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
