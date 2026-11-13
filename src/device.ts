/**
 * Device-code sign-in (stdio only): how a server started without a key gets
 * one with a single approval from a person. The shape is RFC 8628; the result
 * is the person's API key (app.unblockingapi.com, DeviceAuthorization).
 *
 *   POST {app}/device/code  {client_name}  → device_code, user_code, verification_uri_complete, interval
 *   POST {app}/device/token {device_code}  → {api_key} once approved, else {error}
 *
 * The key is saved to the user's config dir (mode 600) so the next start has
 * it. It never goes into a tool result: the model only sees the link and code.
 */
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_APP_URL = "https://app.unblockingapi.com";

export interface DeviceGrant {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export type PollResult =
  | { status: "approved"; apiKey: string }
  | { status: "authorization_pending" | "slow_down" | "access_denied" | "expired_token" | "invalid_grant" };

export function appUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.UNBLOCKINGAPI_APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

/** $XDG_CONFIG_HOME/unblockingapi/credentials, else ~/.config/unblockingapi/credentials. */
export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "unblockingapi", "credentials");
}

/** The saved key, or "" when there is none (or the file is unreadable). */
export function readSavedKey(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const saved = JSON.parse(readFileSync(credentialsPath(env), "utf8")) as { api_key?: unknown };
    return typeof saved.api_key === "string" ? saved.api_key.trim() : "";
  } catch {
    return "";
  }
}

export async function saveKey(apiKey: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const path = credentialsPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ api_key: apiKey }, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600); // writeFile's mode only applies when it creates the file
  return path;
}

export async function startDeviceGrant(clientName: string, base = appUrl(), timeoutMs = 15_000): Promise<DeviceGrant> {
  const res = await fetch(`${base}/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "unblockingapi-mcp" },
    body: JSON.stringify({ client_name: clientName }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<DeviceGrant> & { error_description?: string };
  if (!res.ok || !body.device_code || !body.user_code || !body.verification_uri_complete) {
    throw new Error(body.error_description || `Could not start sign-in (HTTP ${res.status}).`);
  }
  return body as DeviceGrant;
}

export async function pollDeviceGrant(deviceCode: string, base = appUrl(), timeoutMs = 15_000): Promise<PollResult> {
  const res = await fetch(`${base}/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "unblockingapi-mcp" },
    body: JSON.stringify({ device_code: deviceCode }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json().catch(() => ({}))) as { api_key?: string; error?: string };
  if (res.ok && body.api_key) return { status: "approved", apiKey: body.api_key };
  if (res.status === 429) return { status: "slow_down" };
  switch (body.error) {
    case "authorization_pending":
    case "slow_down":
    case "access_denied":
    case "expired_token":
    case "invalid_grant":
      return { status: body.error };
    default:
      throw new Error(`Unexpected answer from sign-in (HTTP ${res.status}).`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until approved, refused, expired, or `budgetMs` runs out ("pending").
 * Honours the server's interval and backs off by 5 s on slow_down (§3.5).
 */
export async function waitForApproval(
  grant: DeviceGrant,
  { budgetMs, base = appUrl(), intervalMs = grant.interval * 1000 }: { budgetMs: number; base?: string; intervalMs?: number },
): Promise<PollResult | { status: "pending" }> {
  const deadline = Date.now() + budgetMs;
  let wait = intervalMs;
  while (Date.now() + wait <= deadline) {
    await sleep(wait);
    const result = await pollDeviceGrant(grant.device_code, base);
    if (result.status === "slow_down") wait += 5_000;
    else if (result.status !== "authorization_pending") return result;
  }
  return { status: "pending" };
}
