#!/usr/bin/env node
// Drives the hosted entry (dist/http.js) over Streamable HTTP with the MCP
// client. Starts its own server on a spare port unless MCP_URL points at a
// running one (e.g. MCP_URL=https://mcp.unblockingapi.com/mcp). Without a real
// UNBLOCKINGAPI_KEY it checks the transport, auth gate and keyless tools; with
// one it also performs a live fetch that costs a credit.
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const key = process.env.UNBLOCKINGAPI_KEY ?? "";
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const text = (r) => r.content?.map((c) => c.text ?? "").join("\n") ?? "";

let child;
let url = process.env.MCP_URL;
if (!url) {
  const port = 18000 + Math.floor(Math.random() * 1000);
  child = spawn(process.execPath, ["dist/http.js"], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => d.toString().includes("listening") && resolve());
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
  url = `http://127.0.0.1:${port}/mcp`;
}
const base = url.replace(/\/mcp\/?$/, "");

async function connect(apiKey) {
  const client = new Client({ name: "smoke-http", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
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
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const anonBody = await anon.json().catch(() => ({}));
  check(
    "no key → 401 with WWW-Authenticate",
    anon.status === 401 && /Bearer/.test(anon.headers.get("www-authenticate") ?? "") && /API key/.test(anonBody.error?.message ?? ""),
    `${anon.status} ${anonBody.error?.message?.slice(0, 60) ?? ""}`,
  );

  const get = await fetch(url, { headers: { Authorization: "Bearer x", Accept: "text/event-stream" } });
  check("GET /mcp → 405 (stateless)", get.status === 405, String(get.status));

  // --- 2. MCP over HTTP with a key that the API will refuse ------------------
  {
    const c = await connect(key || "sk_invalid_smoke_key");
    check("instructions over http", (c.getInstructions() ?? "").includes("find_templates"));
    const { tools } = await c.listTools();
    check("tools over http", tools.map((t) => t.name).sort().join(",") === "find_templates,unblock_fetch");
    const t = await c.callTool({ name: "find_templates", arguments: { url: "https://www.google.com/search?q=x" } });
    check("find_templates (keyless) over http", !t.isError && text(t).includes("kjellberg/google-search"), text(t).split("\n")[0]);
    if (!key) {
      const r = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com" } });
      check("bad key → 401 message", r.isError === true && text(r).includes("401"), text(r).slice(0, 80));
    }
    await c.close();
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
}

console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
