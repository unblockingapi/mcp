/**
 * Thin client for the UnblockingAPI public HTTP API (https://api.unblockingapi.com).
 *
 * Wraps the two public endpoints the MCP exposes:
 *   - GET|POST /unblock          → fetch a URL (plain HTTP or browser-rendered)
 *   - GET|POST /api/:api_name    → predefined templates (e.g. google-search) → structured JSON
 *
 * Auth is an API key sent as `X-Api-Key`. The whole API is synchronous; a rendered
 * fetch can take up to ~35s, so the client uses a generous default timeout.
 */

const DEFAULT_BASE_URL = "https://api.unblockingapi.com";
const DEFAULT_TIMEOUT_MS = 45_000;

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

/** Successful /unblock or /api/:name response (failure shape shares these fields). */
export interface ApiResult {
  job_id: string;
  url: string;
  status: "succeeded" | "failed";
  http_response_code: number | null;
  response_time_ms: number | null;
  render: boolean;
  location: string | null;
  response_format: "html" | "json";
  api_name?: string;
  error?: string;
  response?: string | unknown;
}

export class UnblockingApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) {
      throw new Error(
        "UnblockingAPI key is required. Set the UNBLOCKINGAPI_KEY environment variable.",
      );
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** GET|POST /unblock — params become a query string; undefined/null are dropped. */
  async unblock(params: Record<string, unknown>): Promise<ApiResult> {
    return this.request("/unblock", params);
  }

  /** GET|POST /api/:api_name — predefined template returning parsed JSON. */
  async template(apiName: string, params: Record<string, unknown>): Promise<ApiResult> {
    return this.request(`/api/${encodeURIComponent(apiName)}`, params);
  }

  private async request(path: string, params: Record<string, unknown>): Promise<ApiResult> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      query.set(key, String(value));
    }

    const url = `${this.baseUrl}${path}?${query.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          "X-Api-Key": this.apiKey,
          Accept: "application/json",
          "User-Agent": "unblockingapi-mcp",
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new UnblockingApiError(
          `Request timed out after ${this.timeoutMs}ms. Rendered fetches can be slow — try increasing the timeout or simplifying the wait conditions.`,
        );
      }
      throw new UnblockingApiError(
        `Network error calling UnblockingAPI: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new UnblockingApiError(
        `UnblockingAPI returned non-JSON response (HTTP ${res.status})`,
        res.status,
        text.slice(0, 500),
      );
    }

    if (res.status === 401) {
      throw new UnblockingApiError("Invalid or missing API key (HTTP 401).", 401, json);
    }
    if (res.status === 429) {
      throw new UnblockingApiError(
        "Rate limit exceeded (HTTP 429). Limits: 60 requests/min, 3/sec.",
        429,
        json,
      );
    }
    if (res.status === 422) {
      const msg = (json as { error?: string }).error ?? "Parameter validation error";
      throw new UnblockingApiError(`${msg} (HTTP 422).`, 422, json);
    }

    // 200 success, plus 502/504 which still carry a structured failed-result body.
    return json as ApiResult;
  }
}
