#!/usr/bin/env node
// Drives the built server over stdio with the MCP client. Runs without an API
// key (tool listing, keyless template catalogue, clean error paths); with
// UNBLOCKINGAPI_KEY set it also performs live fetches that cost credits.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const key = process.env.UNBLOCKINGAPI_KEY ?? "";
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function connect(env) {
  const client = new Client({ name: "smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, ...env },
    stderr: "pipe",
  });
  await client.connect(transport);
  return client;
}

const text = (r) => r.content?.map((c) => c.text ?? "").join("\n") ?? "";

// --- 1. No key: server starts, tools listed, fetch fails cleanly -------------
{
  const c = await connect({ UNBLOCKINGAPI_KEY: "" });
  const instructions = c.getInstructions();
  check("server instructions present", !!instructions && instructions.includes("render=false"));
  const { tools } = await c.listTools();
  const names = tools.map((t) => t.name).sort();
  check("tools", JSON.stringify(names) === JSON.stringify(["find_templates", "unblock_fetch"]), names.join(","));
  const fetchTool = tools.find((t) => t.name === "unblock_fetch");
  const props = Object.keys(fetchTool.inputSchema.properties).sort();
  check(
    "unblock_fetch params",
    ["detect_ms", "location", "max_age", "max_chars", "render", "settle_ms", "template", "url", "wait_for", "wait_rules"].every((p) => props.includes(p)),
    props.join(","),
  );
  check("no legacy params", !props.some((p) => ["wait", "block_assets", "remove_scripts"].includes(p)));
  check("annotations read-only", fetchTool.annotations?.readOnlyHint === true);

  const r = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com" } });
  check(
    "no key → isError telling you to set UNBLOCKINGAPI_KEY",
    r.isError === true && text(r).includes("Set UNBLOCKINGAPI_KEY"),
    text(r).slice(0, 90),
  );
  await c.close();
}

// --- 1b. No key, running as a plugin: point at /plugin configure -------------
{
  const c = await connect({ UNBLOCKINGAPI_KEY: "", CLAUDE_PLUGIN_ROOT: "/tmp/fake-plugin" });
  const r = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com" } });
  check(
    "no key in plugin → points at /plugin configure",
    r.isError === true && text(r).includes("/plugin configure unblockingapi@unblockingapi-plugins"),
    text(r).slice(0, 110),
  );

  const bad = await c.callTool({ name: "unblock_fetch", arguments: { url: "not a url" } });
  check("invalid url rejected by schema", bad.isError === true, text(bad).slice(0, 80));

  const t = await c.callTool({ name: "find_templates", arguments: {} });
  check("find_templates (keyless)", !t.isError && text(t).includes("kjellberg/google-search"), text(t).split("\n")[0]);
  const ts = await c.callTool({ name: "find_templates", arguments: { url: "https://www.allabolag.se/foretag/ikea-of-sweden-ab/x/y/2JYQ49RI5YFC1" } });
  check("find_templates matches a URL", !ts.isError && text(ts).includes("kjellberg/allabolag"), text(ts).split("\n")[0]);
  const tm = await c.callTool({ name: "find_templates", arguments: { url: "https://example.com/nothing" } });
  check("find_templates reports no match", !tm.isError && text(tm).includes("No template covers"), text(tm).split("\n")[0]);
  await c.close();
}

// --- 2. Bad key: 401 surfaced ------------------------------------------------
{
  const c = await connect({ UNBLOCKINGAPI_KEY: "sk_invalid_smoke_key" });
  const r = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com" } });
  check("bad key → 401 message", r.isError === true && text(r).includes("401"), text(r).slice(0, 80));
  await c.close();
}

// --- 3. Live (only with a real key) -----------------------------------------
if (key) {
  const c = await connect({ UNBLOCKINGAPI_KEY: key });
  // max_age must be sent on the priming request too: only opted-in traffic populates the cache.
  const r1 = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com", max_age: 120 } });
  const m1 = text(r1);
  check("live plain fetch succeeded", !r1.isError && m1.includes('"status": "succeeded"'), m1.slice(0, 120).replace(/\n/g, " "));
  check("live plain fetch has HTML body", m1.includes("<h1>Example Domain</h1>"));

  const r2 = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com", max_age: 120 } });
  check("live max_age cache hit", !r2.isError && text(r2).includes('"cached": true'), text(r2).slice(0, 120).replace(/\n/g, " "));

  const r3 = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com", render: true, wait_for: "h1", settle_ms: 3000 } });
  check("live render with wait_for", !r3.isError && text(r3).includes('"render": true'), text(r3).slice(0, 120).replace(/\n/g, " "));

  // Structured extraction via a plain-HTTP template — an easy target that does
  // not depend on the render fleet. Field list comes from the catalogue.
  const r4 = await c.callTool({
    name: "unblock_fetch",
    arguments: { url: "https://marbellaliving.com/search.php?sort=latest&page=1", template: "kjellberg/marbella-living-search" },
  });
  const m4 = text(r4);
  check(
    "live template → JSON",
    !r4.isError && m4.includes('"response_format": "json"') && m4.includes('"api_name": "marbella-living-search"') && m4.includes('"results"'),
    m4.slice(0, 160).replace(/\n/g, " "),
  );

  const r5 = await c.callTool({ name: "unblock_fetch", arguments: { url: "https://example.com/nope", template: "nobody/does-not-exist" } });
  check("live unknown template → 404 message", r5.isError && text(r5).includes("404"), text(r5).slice(0, 100));
  await c.close();
} else {
  console.log("SKIP  live fetches (set UNBLOCKINGAPI_KEY to run them; they cost credits)");
}

console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
