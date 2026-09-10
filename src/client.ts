/**
 * Thin client for the UnblockingAPI public HTTP API (https://api.unblockingapi.com).
 *
 * Endpoints used by the MCP server:
 *   - POST /unblock          → fetch a URL (plain HTTP or browser-rendered), optionally
 *                              parsed into JSON by a named template (`template=<name>`)
 *   - GET  /templates.json   → keyless catalogue of published templates
 *
 * Auth is an API key sent as `X-Api-Key`. The API is synchronous: a plain fetch
 * gives up after 30s, a rendered fetch after 140s, so the client's default
 * timeout sits above the render ceiling to let the API's own 504 body through.
 */

const DEFAULT_BASE_URL = "https://api.unblockingapi.com";
// RenderCrawler::REQUEST_TIMEOUT is 140s server-side; a plain fetch is 30s.
const DEFAULT_TIMEOUT_MS = 150_000;

/**
 * "No key" means something different depending on how the server was launched,
 * and the wrong instruction here is the difference between a 10-second fix and
 * a support ticket. Inside the Claude Code plugin the key belongs to the
 * plugin's own config, not to an env var the user can usefully edit.
 *
 * The marker is UNBLOCKINGAPI_PLUGIN, which the plugin's own .mcp.json sets.
 * CLAUDE_PLUGIN_ROOT looks like the natural signal and is what the docs
 * describe for `${…}` expansion inside .mcp.json — but it is NOT exported into
 * the server process, so keying off it silently produced the wrong advice for
 * exactly the users who needed the right advice. Verified live.
 */
export function missingKeyMessage(env: NodeJS.ProcessEnv = process.env): string {
  const base = "No UnblockingAPI key is configured. Get one at https://unblockingapi.com (500 free credits).";
  const inPlugin = env.UNBLOCKINGAPI_PLUGIN === "1" || !!env.CLAUDE_PLUGIN_ROOT;
  return inPlugin
    ? `${base} This plugin has no key yet: run "/plugin configure unblockingapi@unblockingapi-plugins" in Claude Code, paste the key, then reconnect the server from /mcp.`
    : `${base} Set UNBLOCKINGAPI_KEY in the server's environment.`;
}

export class UnblockingApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "UnblockingApiError";
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface WaitRule {
  /** CSS selector probed for visibility. */
  if: string;
  /** Replacement wait_for when the guard is visible. Empty = capture as-is. */
  then?: string;
}

/** Caller-facing parameters of GET|POST /unblock. */
export interface UnblockParams {
  url: string;
  render?: boolean;
  location?: string;
  wait_for?: string;
  settle_ms?: number;
  wait_rules?: WaitRule[];
  detect_ms?: number;
  max_age?: number;
  template?: string;
}

/** Body of every /unblock response that carries a result — 200, 404, 500, 503, 504. */
export interface ApiResult {
  job_id: string;
  url: string;
  status: "succeeded" | "failed";
  http_response_code: number | null;
  response_time_ms: number | null;
  render: boolean;
  location: string | null;
  response_format: "html" | "json";
  /** The template used, when one was requested. */
  api_name?: string;
  /** The template matched but its parser failed; `response` is raw HTML. */
  parse_error?: boolean;
  /** Served from the opt-in max_age cache. */
  cached?: boolean;
  error?: string;
  response?: string | unknown;
}

/** One entry of the public template catalogue (GET /templates.json). */
export interface TemplateEntry {
  reference: string;
  api_name: string;
  name: string;
  description: string;
  username: string;
  category: string;
  category_label: string;
  host: string;
  path: string;
  fields: string[];
  field_count: number;
  render: boolean;
  location: string | null;
  stars_count: number;
  forks_count: number;
  requests_count: number;
  page_url: string;
  sample_url: string;
  editor_url: string;
}

export interface TemplateCategory {
  slug: string;
  name: string;
  group: string;
  description: string;
  templates_count: number;
}

export interface TemplateCatalogue {
  categories: TemplateCategory[];
  templates: TemplateEntry[];
}

export class UnblockingApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** POST /unblock with a JSON body; undefined/null/empty values are dropped. */
  async unblock(params: UnblockParams): Promise<ApiResult> {
    if (!this.apiKey) {
      throw new UnblockingApiError(missingKeyMessage(), 401);
    }

    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      body[key] = value;
    }

    const res = await this.fetchWithTimeout(`${this.baseUrl}/unblock`, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "unblockingapi-mcp",
      },
      body: JSON.stringify(body),
    });

    const json = await this.parseJson(res);
    const isResult = typeof json === "object" && json !== null && "status" in json;

    // Bodies without a `status` are plain `{error}` envelopes from auth, credit,
    // validation, template-lookup or concurrency gates — never a crawl result.
    if (!isResult) {
      const msg = (json as { error?: string })?.error;
      switch (res.status) {
        case 401:
          throw new UnblockingApiError("Invalid or missing API key (HTTP 401).", 401, json);
        case 402:
          throw new UnblockingApiError(
            `${msg ?? "Out of credits"} (HTTP 402). Top up at https://unblockingapi.com/billing`,
            402,
            json,
          );
        case 404:
          throw new UnblockingApiError(
            `${msg ?? "Unknown template"} (HTTP 404). Use find_templates to see what is available.`,
            404,
            json,
          );
        case 422:
          throw new UnblockingApiError(`${msg ?? "Invalid parameters"} (HTTP 422).`, 422, json);
        case 429:
          throw new UnblockingApiError(
            `${msg ?? "Too many requests in flight for this API key"} (HTTP 429). Wait for an in-flight request to finish, then retry.`,
            429,
            json,
          );
        case 503:
          throw new UnblockingApiError(
            `${msg ?? "Service temporarily unavailable"} (HTTP 503). Retry in a few seconds.`,
            503,
            json,
          );
        default:
          throw new UnblockingApiError(
            `${msg ?? "Unexpected response"} (HTTP ${res.status}).`,
            res.status,
            json,
          );
      }
    }

    // 200 / 404 successes, plus 500 / 503 / 504 which carry a failed result body.
    return json as ApiResult;
  }

  /** GET /templates.json — public, no key required. */
  async templates(): Promise<TemplateCatalogue> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/templates.json?limit=200`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "unblockingapi-mcp" },
    });
    const json = await this.parseJson(res);
    if (!res.ok) {
      throw new UnblockingApiError(`Could not load the template catalogue (HTTP ${res.status}).`, res.status, json);
    }
    return json as TemplateCatalogue;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new UnblockingApiError(
          `Request timed out after ${this.timeoutMs}ms. Rendered fetches can take up to 140s — raise UNBLOCKINGAPI_TIMEOUT_MS or lower settle_ms.`,
        );
      }
      throw new UnblockingApiError(`Network error calling UnblockingAPI: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJson(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new UnblockingApiError(
        `UnblockingAPI returned a non-JSON response (HTTP ${res.status}).`,
        res.status,
        text.slice(0, 500),
      );
    }
  }
}
