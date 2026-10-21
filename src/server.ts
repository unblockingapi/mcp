/**
 * The MCP server itself: instructions, tools and their rendering, independent
 * of the transport. `createServer` binds one UnblockingAPI client (one API key)
 * to a fresh McpServer; the stdio entry (index.ts) makes one for the process,
 * the hosted entry (http.ts) one per request with the caller's key.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  UnblockingApiClient,
  UnblockingApiError,
  type ApiResult,
  TEMPLATES_MAX_LIMIT,
  type TemplateCatalogue,
  type TemplateEntry,
  type TemplateQuery,
  type UnblockParams,
} from "./client.js";
import { PAGE_CACHE_TTL_MS, PageCache, shapeBody, type BodyFormat } from "./page.js";
import { GUIDE_TOPICS, readGuide, type GuideTopic } from "./guides.js";

export const VERSION = "0.8.1";

/** Default cap on the body returned to the model, after Markdown conversion or `select`. */
const DEFAULT_MAX_CHARS = 80_000;
/** Claude.ai and Desktop take about 150,000 characters per tool result; leave room for the metadata and notes. */
const MAX_MAX_CHARS = 140_000;

/** How long a fetched page is reused for free, in the words the model reads. */
const PAGE_CACHE_TTL_MINUTES = Math.round(PAGE_CACHE_TTL_MS / 60_000);

const INSTRUCTIONS = `UnblockingAPI gives you a real browser and rotating residential proxies for reading the web.
unblock_fetch is useful for pages a plain HTTP fetch can't read: pages that need JavaScript, refuse automated requests, or show different content by country.

Reading a page:
- Leave render unset: the API fetches plainly first and switches to a real browser when the page is blocked, a challenge wall or an empty JavaScript shell (learned per site). render_reason says which.
- The body comes back as Markdown by default. Ask for format "html" when you need markup or attributes (links, data-* values, custom elements); add select (a CSS selector) to keep only the part you need, such as the items of a list. Re-reading the same fetch with another select or format reuses the page already fetched: no new request, no credit.
- Templates turn a page into JSON. Before scraping a well-known site by hand, call find_templates with the URL; if one matches, pass its reference as template.

When the content you need is missing, change the fetch, not just the reading of it:
- a list or feed that continues below the fold or loads more as you scroll: scroll_steps (2-5);
- content filled in after load or behind a spinner: wait_for with a CSS selector of that content (wait_state "nonempty" for text that streams in, "hidden" to wait for a spinner to go);
- a page that shows a consent wall or one of several layouts: wait_rules;
- localised or geo-blocked content: location (2-letter country);
- a page that needs time before it is complete: wait_min_ms.
The response's readiness block and notes say what happened and what to try. Each fetch with new options is a new request.

Building an app or script that fetches pages with UnblockingAPI (a rank tracker, a listings aggregator, a price monitor, …): call get_build_guide first. It explains the REST API, keeping the key server-side, templates and complete recipes, so the app calls the API directly with plain HTTP.

Every successful fetch costs 1 credit; failures are free. Re-reading the exact same fetch (another select or format) within ${PAGE_CACHE_TTL_MINUTES} minutes is free; pass fresh: true to fetch again. max_age accepts the API's cached copy (up to 300 s) but still costs 1 credit.`;

type ToolResult = { isError?: boolean; content: { type: "text"; text: string }[] };

interface RenderOptions {
  maxChars?: number;
  format?: BodyFormat;
  select?: string;
  /** Served from the server's copy of an earlier fetch, this many ms old. */
  reusedAgeMs?: number;
  /** The caller already asked for a wait or scroll. */
  tunedWait?: boolean;
}

/** Render an ApiResult into MCP tool output, marking failures with isError. */
function toToolResult(result: ApiResult, opts: RenderOptions = {}): ToolResult {
  const failed = result.status === "failed";
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const format = opts.format ?? "markdown";
  const html = result.response_format !== "json" && typeof result.response === "string" ? result.response : "";

  let body: string;
  let matched: number | undefined;
  let selectError: string | undefined;
  if (result.response_format === "json") {
    body = JSON.stringify(result.response ?? null, null, 2);
  } else {
    ({ body, matched, selectError } = shapeBody(html, format, opts.select));
  }

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
    ...(result.render_reason ? { render_reason: result.render_reason } : {}),
    response_format: result.response_format === "json" ? "json" : format,
    ...(opts.select && result.response_format !== "json" ? { select: opts.select, matched: matched ?? 0 } : {}),
    ...(result.api_name ? { api_name: result.api_name } : {}),
    ...(result.template_version ? { template_version: result.template_version } : {}),
    ...(result.wait_timed_out ? { wait_timed_out: true } : {}),
    ...(result.readiness ? { readiness: result.readiness } : {}),
    ...(result.parse_error ? { parse_error: true } : {}),
    ...(result.cached ? { cached: true } : {}),
    ...(opts.reusedAgeMs !== undefined ? { reused_fetch: true, reused_age_s: Math.round(opts.reusedAgeMs / 1000) } : {}),
    ...(truncated ? { truncated: true, total_chars: totalChars, returned_chars: maxChars } : {}),
    ...(result.error ? { error: result.error } : {}),
  };

  const notes: string[] = [];
  if (opts.reusedAgeMs !== undefined) {
    notes.push(
      `Re-read from the copy of this exact fetch made ${Math.round(opts.reusedAgeMs / 1000)}s ago: no new request and no credit spent. Pass fresh: true to fetch again.`,
    );
  }
  const verification = result.readiness?.verification;
  if (verification?.status === "interactive") {
    notes.push("The page shows a Cloudflare Turnstile checkbox that needs a human click; waiting longer will not help.");
  }
  if (result.wait_timed_out) {
    notes.push("The requested wait reached its limit; the page was captured as it was and may be incomplete.");
  }
  if (result.parse_error) {
    notes.push("The template's parser failed on this page (its markup may have changed); the page is returned instead.");
  }
  if (selectError) {
    notes.push(`select is not a valid CSS selector (${selectError}); the whole page is returned instead.`);
  } else if (opts.select && matched === 0 && result.response_format !== "json") {
    notes.push(
      `Nothing on the page matches select "${opts.select}". Look at the page with format "html" (and no select) to find the right selector; ` +
        "that re-reads this fetch for free. If the content is not in the page at all, it may need scroll_steps or wait_for.",
    );
  }
  if (truncated) {
    notes.push(
      `Body cut to ${maxChars} of ${totalChars} characters. To get the part you need, re-read with select (a CSS selector for it` +
        (format === "html" ? ', or format "markdown" for a smaller page' : "") +
        ") - that reuses this fetch, no credit - or pass a larger max_chars.",
    );
  }
  // The API renders an empty shell itself unless the caller said render=false,
  // so this only ever fires when the model forced a plain fetch.
  if (!failed && !result.render && result.response_format === "html" && looksLikeItNeedsJs(html)) {
    notes.push(
      "This page looks like it needs JavaScript (little visible text, or a 'JavaScript required' notice). " +
        "Call unblock_fetch again without render=false (or with render=true) to get the rendered DOM.",
    );
  }
  // A rendered page is captured without scrolling unless asked, so feeds and
  // lazy lists come back with their first screen only, and nothing in the page
  // says so. Say it on every untuned render: one line, and it is the cue an
  // agent otherwise never gets (reddit: 3 posts unscrolled, 27 with 4 steps).
  if (!failed && result.render && result.response_format !== "json" && !opts.tunedWait) {
    const unsettled = result.readiness && result.readiness.status !== "satisfied";
    notes.push(
      "Captured without scrolling. If this is a feed or list that continues, or content you expected is missing, fetch again with " +
        'scroll_steps (e.g. 3-5) to load more, or wait_for "<css selector of the content>" (wait_state "nonempty") for content that appears late' +
        (unsettled ? " - the page had not settled when it was captured" : "") +
        ".",
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
 * Does this template cover that URL? A port of Rails' Templates::Matcher, the
 * grammar the editor and the library suggest templates with, so this answers
 * the same:
 *   host  labels compared exactly after dropping "www.", with an optional
 *         leading "*." (the apex and any subdomain) or trailing ".*" (one or
 *         two TLD labels: .com, .co.uk);
 *   path  a segment prefix: "*" is exactly one segment, "**" the rest, and a
 *         "*" inside a segment is any run of characters ("/*.html", "/p/item-*").
 * The catalogue does not expose a template's required query keys, so those
 * are not checked here.
 */
export function templateMatchesUrl(template: TemplateEntry, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const stripWww = (h: string) => h.trim().toLowerCase().replace(/^www\./, "");
  const patternHost = stripWww(template.host ?? "");
  if (!patternHost) return false;
  return hostMatches(patternHost.split("."), stripWww(parsed.hostname).split(".")) && pathMatches(template.path ?? "/", parsed.pathname);
}

function hostMatches(pattern: string[], labels: string[]): boolean {
  if (pattern[0] === "*") {
    const rest = pattern.slice(1);
    return labels.length >= rest.length && labels.slice(labels.length - rest.length).join(".") === rest.join(".");
  }
  if (pattern[pattern.length - 1] === "*") {
    const head = pattern.slice(0, -1);
    const tld = labels.length - head.length;
    return labels.slice(0, head.length).join(".") === head.join(".") && tld >= 1 && tld <= 2;
  }
  return labels.join(".") === pattern.join(".");
}

function pathMatches(patternPath: string, path: string): boolean {
  const normalized = patternPath.trim() || "/";
  const pattern = normalized === "/" ? [] : normalized.replace(/\/+$/, "").replace(/^\//, "").split("/");
  const segments = path.split("/").filter(Boolean);
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "**") return true;
    const segment = segments[i];
    if (segment === undefined || !segmentMatches(pattern[i], segment)) return false;
  }
  return true;
}

/** "*" anywhere in a segment pattern is any run of characters; literal pieces must appear in order. */
function segmentMatches(pattern: string, segment: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return segment === pattern;
  const parts = pattern.split("*");
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!segment.startsWith(first)) return false;
  let at = first.length;
  for (const piece of parts.slice(1, -1)) {
    if (!piece) continue;
    const found = segment.indexOf(piece, at);
    if (found < 0) return false;
    at = found + piece.length;
  }
  return !last || (segment.endsWith(last) && segment.length - last.length >= at);
}

/**
 * The catalogue is public and changes slowly; one fetch per 5 minutes keeps
 * repeated discovery calls off the wire without going stale in a session.
 */
const CATALOGUE_TTL_MS = 5 * 60 * 1000;
const QUERY_CACHE_MAX = 100;
let catalogueCache: { at: number; catalogue: TemplateCatalogue } | null = null;
const queryCache = new Map<string, { at: number; catalogue: TemplateCatalogue }>();
/** Until when the API is known to be one that ignores url / q / page (no `total` in its answer). */
let legacyFeedUntil = 0;

/** Forget every cached catalogue answer (tests). */
export function resetTemplateCaches(): void {
  catalogueCache = null;
  queryCache.clear();
  legacyFeedUntil = 0;
}

async function currentCatalogue(client: UnblockingApiClient): Promise<TemplateCatalogue> {
  if (catalogueCache && Date.now() - catalogueCache.at < CATALOGUE_TTL_MS) {
    return catalogueCache.catalogue;
  }
  const catalogue = await client.templates();
  catalogueCache = { at: Date.now(), catalogue };
  return catalogue;
}

async function queriedCatalogue(client: UnblockingApiClient, query: TemplateQuery): Promise<TemplateCatalogue> {
  const key = JSON.stringify(query);
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < CATALOGUE_TTL_MS) return hit.catalogue;
  const catalogue = await client.templates(query);
  queryCache.delete(key);
  queryCache.set(key, { at: Date.now(), catalogue });
  for (const [oldest] of queryCache) {
    if (queryCache.size <= QUERY_CACHE_MAX) break;
    queryCache.delete(oldest);
  }
  return catalogue;
}

export interface TemplateSearch {
  /** Every template matching the filters, across all pages. */
  matched: number;
  /** The requested page of them. */
  templates: TemplateEntry[];
  categories: TemplateCatalogue["categories"];
  /** Only a slice of the catalogue could be searched (an API without server-side search, at its 200 cap). */
  partialCatalogue?: number;
}

/**
 * Ask the API to match url / search / category over the whole catalogue and
 * return one page. An API that predates server-side search answers without
 * `total`; then filter its most-used 200 here, as before, and say so when
 * that list was cut at the cap.
 */
export async function searchTemplates(
  client: UnblockingApiClient,
  opts: { url?: string; search?: string; category?: string; limit: number; page: number },
): Promise<TemplateSearch> {
  const { url, search, category, limit, page } = opts;
  if (Date.now() >= legacyFeedUntil) {
    const answer = await queriedCatalogue(client, { url, q: search, category, limit, page });
    if (typeof answer.total === "number") {
      return { matched: answer.total, templates: answer.templates, categories: answer.categories };
    }
    legacyFeedUntil = Date.now() + CATALOGUE_TTL_MS;
  }

  const catalogue = await currentCatalogue(client);
  let templates = catalogue.templates;
  if (url) templates = templates.filter((t) => templateMatchesUrl(t, url));
  if (category) templates = templates.filter((t) => t.category === category);
  if (search) {
    const needle = search.toLowerCase();
    templates = templates.filter((t) =>
      [t.name, t.reference, t.host, t.description].some((s) => s?.toLowerCase().includes(needle)),
    );
  }
  return {
    matched: templates.length,
    templates: templates.slice((page - 1) * limit, page * limit),
    categories: catalogue.categories,
    ...(catalogue.templates.length >= TEMPLATES_MAX_LIMIT ? { partialCatalogue: catalogue.templates.length } : {}),
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Shared by every server instance in the process; partitioned by API key. */
const pageCache = new PageCache();

/** Where a template's output shape is published (keyless). */
const TEMPLATE_DETAILS_BASE = (process.env.UNBLOCKINGAPI_APP_URL || "https://app.unblockingapi.com").replace(/\/+$/, "");

/** A template's JSON output shape, or null when it can't be fetched. */
async function templateShape(reference: string): Promise<string | null> {
  try {
    const res = await fetch(`${TEMPLATE_DETAILS_BASE}/public/v1/templates/${reference}`, {
      headers: { Accept: "application/json", "User-Agent": "unblockingapi-mcp" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { response_skeleton?: string };
    return body.response_skeleton ?? null;
  } catch {
    return null;
  }
}

// --- Shared parameter schemas -----------------------------------------------
const locationSchema = z
  .string()
  .regex(/^[a-zA-Z]{2}$/, "2-letter ISO country code")
  .optional()
  .describe("2-letter country code to proxy through (e.g. 'us', 'gb', 'de'). Most countries are supported; an unsupported one is refused with the list.");

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
  .max(MAX_MAX_CHARS)
  .optional()
  .describe(
    `Cap on returned body characters (default ${DEFAULT_MAX_CHARS}, max ${MAX_MAX_CHARS}). Longer bodies are cut with a note; ` +
      "select narrows a page to the part you need instead.",
  );

const waitRuleSchema = z.object({
  if: z.string().describe("CSS selector to probe for visibility."),
  then: z
    .string()
    .optional()
    .describe("Replacement wait_for when the guard is visible: a mode or a CSS selector. Empty = capture as-is."),
});

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

export function createServer(client: UnblockingApiClient): McpServer {
  const server = new McpServer({ name: "unblockingapi", title: "UnblockingAPI", version: VERSION }, { instructions: INSTRUCTIONS });

  // --- Tool: unblock_fetch -----------------------------------------------------
  server.registerTool(
    "unblock_fetch",
    {
      title: "Fetch a URL through UnblockingAPI",
      description:
        "Fetch a web page through UnblockingAPI's rotating residential proxies and a real browser. " +
        "Useful for pages a plain HTTP fetch can't read: pages that need JavaScript, refuse automated " +
        "requests, or show different content by country. " +
        "Returns the page as Markdown (or cleaned HTML with format: 'html'); select narrows it to the part you need. " +
        "If content is missing, fetch again with scroll_steps or wait_for. Picks the " +
        "mode itself by default: a plain HTTP fetch first, and a real browser when the site blocks it " +
        "or needs JavaScript. Pass a template reference to get structured JSON instead of HTML — call " +
        "find_templates with the url first to see whether one exists. " +
        "Costs 1 credit per successful fetch; failures are free.",
      inputSchema: {
        url: z.string().url().describe("The HTTP/HTTPS URL to fetch. Media and binary files are rejected."),
        render: z
          .boolean()
          .optional()
          .describe(
            "Omit to let the API decide (plain fetch first, a browser when blocked or when the page is " +
              "an empty JavaScript shell; learned per site). true always renders with a real browser " +
              "(slower, up to ~2 min worst case); false never does. Any wait option implies true.",
          ),
        location: locationSchema,
        wait_for: z
          .string()
          .max(500)
          .optional()
          .describe(
            "Implies a browser. When to capture: 'stable' (default — once the DOM stops changing), " +
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
            "Implies a browser. Ceiling (not a delay) on the settle wait, default 5000. Capture happens as " +
              "soon as the DOM has been quiet for 500ms. Use wait_min_ms for a minimum delay; lower this to cap the worst case.",
          ),
        wait_rules: z
          .array(waitRuleSchema)
          .max(10)
          .optional()
          .describe(
            "Implies a browser. Conditional waits for pages with several possible layouts (consent gate, " +
              "interstitial, A/B variant). Each 'if' selector is probed in order for detect_ms; the first " +
              "visible one wins and its 'then' replaces wait_for. Example: [{if: '#consent', then: '#results'}].",
          ),
        detect_ms: z
          .number()
          .int()
          .min(0)
          .max(25_000)
          .optional()
          .describe("Implies a browser. How long to probe wait_rules guards before falling back to wait_for. Default 800."),
        wait_state: z
          .enum(["visible", "nonempty", "hidden", "stable"])
          .optional()
          .describe(
            "Condition for a CSS selector in wait_for (requires one): 'visible' (default), 'nonempty' " +
              "(visible text, ignoring loading placeholders), 'hidden' (all matches hidden or gone — e.g. a " +
              "spinner), 'stable' (text and match count unchanged for 750ms).",
          ),
        scroll_steps: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe(
            "Implies a browser. Scroll down this many times before the readiness check, to trigger " +
              "lazy-loaded sections. Bounded discovery, not a way to collect an infinite list.",
          ),
        wait_min_ms: z
          .number()
          .int()
          .min(0)
          .max(10_000)
          .optional()
          .describe(
            "Implies a browser. Minimum delay after navigation before scrolling or checking readiness, " +
              "for content that is absent from the first capture.",
          ),
        max_age: maxAgeSchema,
        template: z
          .string()
          .regex(
            /^(?:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\/)?[a-z0-9][a-z0-9-]{1,48}[a-z0-9](?:@[1-9]\d{0,8})?$/,
            "template reference like 'handle/name', optionally pinned as 'handle/name@3'",
          )
          .optional()
          .describe(
            "Parse the page with a published template and return JSON instead of HTML. Takes a " +
              "template reference like 'handle/name' — call find_templates with this url first to see " +
              "whether one covers the site. Append '@<version>' to pin a version (the response's " +
              "template_version is the one that answered). The template forces its own render and wait settings.",
          ),
        format: z
          .enum(["markdown", "html"])
          .optional()
          .describe(
            'How the page comes back (template results are always JSON). "markdown" (default): text, headings, links and ' +
              'lists, a fraction of the size. "html": the cleaned markup, for attributes, custom elements and choosing a select.',
          ),
        select: z
          .string()
          .max(500)
          .optional()
          .describe(
            "CSS selector: return only the matching elements (e.g. 'article', 'table tr', 'shreddit-post'), in the chosen " +
              "format. Re-reading a fetch with another select or format reuses the page already fetched - no credit.",
          ),
        fresh: z
          .boolean()
          .optional()
          .describe(
            `Fetch again even if this exact fetch was made in the last ${PAGE_CACHE_TTL_MINUTES} minutes (by default that copy is reused for free).`,
          ),
        max_chars: maxCharsSchema,
      },
      annotations: readOnly,
    },
    async ({ max_chars, format, select, fresh, ...params }) =>
      safe(async () => {
        const fetchParams = params as UnblockParams;
        const key = PageCache.key(client.apiKey, fetchParams);
        const tunedWait = Boolean(
          fetchParams.wait_for || fetchParams.scroll_steps || fetchParams.wait_min_ms || fetchParams.wait_rules?.length,
        );
        const reused = fresh ? undefined : pageCache.get(key);
        if (reused) {
          return toToolResult(reused.result, { maxChars: max_chars, format, select, tunedWait, reusedAgeMs: reused.ageMs });
        }
        const result = await client.unblock(fetchParams);
        if (result.status === "succeeded" && client.apiKey) pageCache.set(key, result);
        return toToolResult(result, { maxChars: max_chars, format, select, tunedWait });
      }),
  );

  // --- Tool: find_templates ----------------------------------------------------
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
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Which page of `limit` results to return, from 1, when more templates match than fit."),
      },
      annotations: { ...readOnly, openWorldHint: false },
    },
    async ({ url, search, category, limit, page }) =>
      safe(async () => {
        const perPage = limit ?? DEFAULT_TEMPLATE_LIMIT;
        const pageNo = page ?? 1;
        const { matched, templates: shown, categories: categoryRows, partialCatalogue } = await searchTemplates(client, {
          url,
          search,
          category,
          limit: perPage,
          page: pageNo,
        });
        const categories = categoryRows
          .filter((c) => c.templates_count > 0)
          .map((c) => `${c.slug} (${c.templates_count})`)
          .join(", ");
        const partialNote = partialCatalogue
          ? `\n\nNote: only the ${partialCatalogue} most-used templates could be searched; the catalogue may hold more, so a less-used match can be missing.`
          : "";

        if (!matched) {
          const miss = url
            ? `No template covers ${url}; fetch it with unblock_fetch.`
            : "Nothing matched.";
          return { content: [{ type: "text", text: `${miss}\n\nCategories: ${categories}${partialNote}` }] };
        }
        if (!shown.length) {
          return {
            content: [{ type: "text", text: `${matched} template(s) match, but page ${pageNo} is past the last one.${partialNote}` }],
          };
        }

        // A short list is a decision about to be made: include what each
        // template returns, so an agent writing code knows the JSON shape.
        const shapes = shown.length <= 3 ? await Promise.all(shown.map((t) => templateShape(t.reference))) : [];
        const described = shown.map((t, i) =>
          shapes[i] ? `${formatTemplate(t)}\n    returns: ${shapes[i]!.replace(/\s+/g, " ")}` : formatTemplate(t),
        );

        const first = (pageNo - 1) * perPage + 1;
        const last = first + shown.length - 1;
        const more = last < matched ? `, raise limit or pass page: ${pageNo + 1}` : "";
        const header =
          matched === shown.length
            ? `${matched} template(s) match:`
            : `${matched} template(s) match, showing ${first}–${last} — narrow with search/category${more}:`;

        return {
          content: [
            {
              type: "text",
              text: `${header}\n\n${described.join("\n\n")}\n\nCategories: ${categories}${partialNote}`,
            },
          ],
        };
      }),
  );

  // --- Tool: get_build_guide ---------------------------------------------------
  server.registerTool(
    "get_build_guide",
    {
      title: "How to build an app on UnblockingAPI",
      description:
        "Read this before writing code that uses UnblockingAPI - an app, script, scheduled job or backend that fetches " +
        "web pages (a rank tracker, a listings aggregator, a price monitor, …). Returns the REST API reference for " +
        "calling it with plain HTTP (no SDK), how to keep the key server-side on platforms like Lovable, Replit and " +
        "Next.js, how to use templates, and complete recipes. Free. Start with topic 'api', then the recipe that fits.",
      inputSchema: {
        topic: z
          .enum(GUIDE_TOPICS.map((g) => g.topic) as [GuideTopic, ...GuideTopic[]])
          .describe(GUIDE_TOPICS.map((g) => `'${g.topic}': ${g.summary}`).join(" ")),
      },
      annotations: { ...readOnly, openWorldHint: false },
    },
    async ({ topic }) => safe(async () => ({ content: [{ type: "text", text: await readGuide(topic) }] })),
  );

  return server;
}
