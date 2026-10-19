/**
 * OAuth for the hosted server. app.unblockingapi.com is the authorization
 * server: MCP clients find it through this server's protected-resource
 * metadata (RFC 9728), register, sign the user in and come back with an
 * `mcp`-scoped access token. This module turns that token into the user's API
 * key by asking Rails (`GET /internal/mcp/session`, pod to pod, guarded by
 * MCP_INTERNAL_TOKEN), so tool calls go out exactly as with a key header and
 * the key never reaches the client.
 */
import { createHash } from "node:crypto";

/** A raw UnblockingAPI key: 64 hex characters (User#generate_api_key). OAuth tokens never look like that. */
const API_KEY_PATTERN = /^[0-9a-f]{64}$/i;

export function looksLikeApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

export interface OAuthConfig {
  /** Rails, reachable from this pod (http://rails-web in the cluster). */
  railsUrl: string;
  /** Mcp.internal_token on the Rails side; without it OAuth is off. */
  internalToken: string;
}

export type TokenLookup =
  | { status: "ok"; apiKey: string }
  | { status: "invalid" }
  | { status: "unavailable"; detail: string };

/**
 * Short, so a revoked or expired token stops working within a minute without
 * a Rails round trip on every JSON-RPC message of a busy session.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 10_000;
const LOOKUP_TIMEOUT_MS = 5_000;

const cache = new Map<string, { apiKey: string; until: number }>();

/** Keyed by a hash so the cache never holds a usable bearer token. */
function cacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function lookupToken(token: string, config: OAuthConfig, now = Date.now()): Promise<TokenLookup> {
  const key = cacheKey(token);
  const hit = cache.get(key);
  if (hit && hit.until > now) return { status: "ok", apiKey: hit.apiKey };
  if (hit) cache.delete(key);

  let res: Response;
  try {
    res = await fetch(`${config.railsUrl.replace(/\/+$/, "")}/internal/mcp/session`, {
      headers: { Authorization: `Bearer ${token}`, "X-Internal-Token": config.internalToken, Accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch (err) {
    return { status: "unavailable", detail: (err as Error).message };
  }

  // 401: missing, expired, revoked or unknown token. 403 with a valid pod
  // token: a token without the mcp scope (the editor's). Both are the
  // client's problem, so both become our 401 and it signs in again.
  if (res.status === 401 || (res.status === 403 && (await res.text()).includes("insufficient_scope"))) {
    return { status: "invalid" };
  }
  if (!res.ok) return { status: "unavailable", detail: `session lookup answered HTTP ${res.status}` };

  const body = (await res.json().catch(() => ({}))) as { api_key?: string; expires_in?: number };
  if (!body.api_key) return { status: "unavailable", detail: "session lookup returned no api_key" };

  const ttl = Math.min(CACHE_TTL_MS, Math.max(0, (body.expires_in ?? 0) * 1000));
  if (ttl > 0) {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { apiKey: body.api_key, until: now + ttl });
  }
  return { status: "ok", apiKey: body.api_key };
}

/** For tests. */
export function clearTokenCache(): void {
  cache.clear();
}
