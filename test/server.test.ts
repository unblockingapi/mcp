import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, templateMatchesUrl, VERSION } from "../src/server.js";
import { UnblockingApiClient, type TemplateEntry } from "../src/client.js";

function entry(host: string, path: string): TemplateEntry {
  return { host, path } as TemplateEntry;
}

test("plain host and path prefix", () => {
  const google = entry("google.com", "/search");
  assert.ok(templateMatchesUrl(google, "https://www.google.com/search?q=x"));
  assert.ok(templateMatchesUrl(google, "https://google.com/search/about"));
  assert.ok(!templateMatchesUrl(google, "https://www.google.com/maps"));
  assert.ok(!templateMatchesUrl(google, "https://www.google.de/search?q=x"));
  // A segment prefix, not a string prefix.
  assert.ok(!templateMatchesUrl(google, "https://www.google.com/searchfoo"));
  assert.ok(!templateMatchesUrl(google, "not a url"));
});

test("a root path covers the whole site, subdomains included", () => {
  const t = entry("hemnet.se", "/");
  assert.ok(templateMatchesUrl(t, "https://www.hemnet.se/bostader?x=1"));
  assert.ok(templateMatchesUrl(t, "https://m.hemnet.se/"));
  assert.ok(!templateMatchesUrl(t, "https://nothemnet.se/"));
});

test("* is one segment and ** any deeper path", () => {
  // As published in the catalogue (kjellberg/idealista-search).
  const t = entry("idealista.com", "/*/**");
  assert.ok(templateMatchesUrl(t, "https://www.idealista.com/venta-viviendas/madrid/"));
  assert.ok(templateMatchesUrl(t, "https://www.idealista.com/alquiler-viviendas"));
  assert.ok(!templateMatchesUrl(t, "https://www.idealista.com/"));

  const reddit = entry("reddit.com", "/r/**");
  assert.ok(templateMatchesUrl(reddit, "https://www.reddit.com/r/mcp/comments/abc/title/"));
  assert.ok(!templateMatchesUrl(reddit, "https://www.reddit.com/user/someone"));
});

test("a * inside a segment, and percent-encoded literals", () => {
  // As published in the catalogue (kjellberg/eniro-foretag).
  const eniro = entry("eniro.se", "/*/f%C3%B6retag");
  assert.ok(templateMatchesUrl(eniro, "https://www.eniro.se/stockholm/f%C3%B6retag"));
  assert.ok(templateMatchesUrl(eniro, "https://www.eniro.se/stockholm/företag"));
  assert.ok(!templateMatchesUrl(eniro, "https://www.eniro.se/stockholm/personer"));

  const html = entry("example.com", "/p/item-*.html");
  assert.ok(templateMatchesUrl(html, "https://example.com/p/item-42.html"));
  assert.ok(!templateMatchesUrl(html, "https://example.com/p/item-42.htm"));
  assert.ok(!templateMatchesUrl(html, "https://example.com/p/thing-42.html"));
});

test("host wildcards", () => {
  const anyTld = entry("google.*", "/search");
  assert.ok(templateMatchesUrl(anyTld, "https://www.google.de/search?q=x"));
  assert.ok(templateMatchesUrl(anyTld, "https://www.google.co.uk/search?q=x"));
  assert.ok(!templateMatchesUrl(anyTld, "https://google.a.b.c/search"));

  const anySub = entry("*.example.com", "/");
  assert.ok(templateMatchesUrl(anySub, "https://example.com/"));
  assert.ok(templateMatchesUrl(anySub, "https://shop.example.com/x"));
  assert.ok(!templateMatchesUrl(anySub, "https://example.org/"));
});

test("registers exactly unblock_fetch and find_templates", async () => {
  const server = createServer(new UnblockingApiClient({ apiKey: "" }));
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);

  assert.equal(client.getServerVersion()?.version, VERSION);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["find_templates", "unblock_fetch"]);

  const fetchTool = tools.find((t) => t.name === "unblock_fetch")!;
  assert.deepEqual(fetchTool.inputSchema.required, ["url"]);
  for (const p of ["url", "render", "location", "wait_for", "settle_ms", "wait_rules", "detect_ms",
    "wait_state", "scroll_steps", "wait_min_ms", "max_age", "template", "max_chars"]) {
    assert.ok(p in (fetchTool.inputSchema.properties ?? {}), `unblock_fetch.${p}`);
  }
  const find = tools.find((t) => t.name === "find_templates")!;
  assert.deepEqual(Object.keys(find.inputSchema.properties ?? {}).sort(), ["category", "limit", "search", "url"]);

  await client.close();
});

test("server metadata stays in sync", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const serverJson = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
  const plugin = JSON.parse(await readFile(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"));
  const market = JSON.parse(await readFile(new URL("../.claude-plugin/marketplace.json", import.meta.url), "utf8"));

  assert.equal(pkg.version, VERSION);
  assert.equal(serverJson.version, VERSION);
  assert.equal(serverJson.packages[0].version, VERSION);
  assert.equal(plugin.version, VERSION);
  assert.equal(market.plugins[0].version, VERSION);
  assert.equal(serverJson.name, pkg.mcpName);

  // Tools removed in 0.4.0 must not come back in any published text.
  const published = JSON.stringify([pkg.description, pkg.keywords, serverJson.description, plugin.description, plugin.keywords]);
  assert.doesNotMatch(published, /google_search|google-search|list_templates|idealista_property|ahrefs_website_authority|serp/i);
});
