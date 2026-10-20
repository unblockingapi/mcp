#!/usr/bin/env node
// Drives the hosted entry (dist/http.js) over Streamable HTTP with the MCP
// client. Starts its own server on a spare port unless MCP_URL points at a
// running one (e.g. MCP_URL=https://mcp.unblockingapi.com/mcp). Without a real
// UNBLOCKINGAPI_KEY it checks the transport, auth gate, OAuth metadata and
// keyless tools; with one it also performs a live fetch that costs a credit.
// Run locally, it also stands in for Rails' /internal/mcp/session to drive the
// OAuth token path.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const key = process.env.UNBLOCKINGAPI_KEY ?? "";
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const text = (r) => r.content?.map((c) => c.text ?? "").join("\n") ?? "";

// A refused key, 64 hex like a real one: the API answers 401 with it.
const REFUSED_KEY = "0".repeat(64);
const POD_TOKEN = "smoke-pod-token";
let sessionLookups = 0;
let fakeRails;

let child;
let url = process.env.MCP_URL;
const local = !url;
if (local) {
  fakeRails = createServer((req, res) => {
    sessionLookups++;
    const auth = req.headers.authorization ?? "";
    if (req.url !== "/internal/mcp/session" || req.headers["x-internal-token"] !== POD_TOKEN) {
      res.writeHead(403).end();
    } else if (auth === "Bearer good-oauth-token") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ user_id: 1, api_key: REFUSED_KEY, expires_in: 7200 }));
    } else {
      res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid_token" }));
    }
  });
  await new Promise((resolve) => fakeRails.listen(0, "127.0.0.1", resolve));
  const port = 18000 + Math.floor(Math.random() * 1000);
  child = spawn(process.execPath, ["dist/http.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      AUTH_ISSUER: "https://app.example.test",
      RAILS_WEB_URL: `http://127.0.0.1:${fakeRails.address().port}`,
      MCP_INTERNAL_TOKEN: POD_TOKEN,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => d.toString().includes("listening") && resolve());
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
  url = `http://127.0.0.1:${port}/mcp`;
}
const base = url.replace(/\/mcp\/?$/, "");

async function connect(bearer) {
  const client = new Client({ name: "smoke-http", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
}

try {
  // --- 1. Plain HTTP surface -------------------------------------------------
  const health = await fetch(`${base}/healthz`);
  check("healthz", health.status === 200);

  const anon = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "unblock_fetch", arguments: { url: "https://example.com" } } }),
  });
  const anonBody = await anon.json().catch(() => ({}));
  const wwwAuth = anon.headers.get("www-authenticate") ?? "";
  check(
    "keyless tools/call → 401 pointing at the resource metadata",
    anon.status === 401 && /^Bearer .*resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/.test(wwwAuth) && /scope="mcp"/.test(wwwAuth),
    `${anon.status} ${wwwAuth.slice(0, 90)}`,
  );
  check("401 body explains both ways in", /OAuth/.test(anonBody.error?.message ?? "") && /API key/.test(anonBody.error?.message ?? ""));

  const prm = await fetch(`${base}/.well-known/oauth-protected-resource`);
  const prmBody = await prm.json().catch(() => ({}));
  check(
    "protected-resource metadata",
    prm.status === 200 && prmBody.resource === url && prmBody.authorization_servers?.length === 1 && prmBody.scopes_supported?.[0] === "mcp",
    JSON.stringify(prmBody).slice(0, 120),
  );
  const prmPath = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
  check("path-suffixed metadata too", prmPath.status === 200);

  // Discovery needs no account: directories probe initialize + tools/list keyless.
  {
    const c = new Client({ name: "smoke-http-anon", version: "0.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(url)));
    const { tools } = await c.listTools();
    check("keyless initialize + tools/list", tools.length === 3, tools.map((t) => t.name).sort().join(","));
    await c.close();
  }

  const get = await fetch(url, { headers: { Authorization: "Bearer x", Accept: "text/event-stream" } });
  check("GET /mcp → 405 (stateless)", get.status === 405, String(get.status));

  // --- 2. MCP over HTTP with a key that the API will refuse ------------------
  {
    const c = await connect(key || REFUSED_KEY);
    check("instructions over http", (c.getInstructions() ?? "").includes("find_templates"));
    const { tools } = await c.listTools();
    check("tools over http", tools.map((t) => t.name).sort().join(",") === "find_templates,get_build_guide,unblock_fetch");
    const t = await c.callTool({ name: "find_templates", arguments: { url: "https://www.google.com/search?q=x" } });
    check("find_templates (keyless) over http", !t.isError && text(t).includes("kjellberg/google-search"), text(t).split("\n")[0]);
    if (!key) {
      const r = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com" } });
      check("bad key → 401 message", r.isError === true && text(r).includes("401"), text(r).slice(0, 80));
    }
    await c.close();
  }

  // --- 2b. OAuth tokens (local only: needs the fake Rails) -------------------
  if (local) {
    const rejected = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer expired-oauth-token", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    check(
      "rejected OAuth token → 401 invalid_token",
      rejected.status === 401 && /error="invalid_token"/.test(rejected.headers.get("www-authenticate") ?? ""),
      `${rejected.status} ${rejected.headers.get("www-authenticate")?.slice(0, 60)}`,
    );

    const before = sessionLookups;
    const c = await connect("good-oauth-token");
    const r = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com" } });
    check("OAuth token → its user's key reaches the API", r.isError === true && text(r).includes("401"), text(r).slice(0, 60));
    await c.listTools();
    await c.close();
    check("token lookups are cached", sessionLookups - before === 1, `${sessionLookups - before} lookups`);

    const hexKey = await connect(REFUSED_KEY);
    await hexKey.listTools();
    await hexKey.close();
    check("a 64-hex bearer is a key, never looked up", sessionLookups - before === 1);
  }

  // --- 3. Live (only with a real key) ----------------------------------------
  if (key) {
    const c = await connect(key);
    const r = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com", max_age: 120 } }, undefined, { timeout: 200_000 });
    check("live fetch over http", !r.isError && text(r).includes("<title>Example Domain</title>"), text(r).slice(0, 100).replace(/\n/g, " "));
    await c.close();
  } else {
    console.log("SKIP  live fetch (set UNBLOCKINGAPI_KEY to run it; it costs a credit)");
  }
} finally {
  child?.kill("SIGTERM");
  fakeRails?.close();
}

console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
