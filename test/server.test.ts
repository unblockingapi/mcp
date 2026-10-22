import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, resetTemplateCaches, templateMatchesUrl, VERSION } from "../src/server.js";
import { UnblockingApiClient, type TemplateEntry } from "../src/client.js";
import { GUIDE_TOPICS } from "../src/guides.js";

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

test("a root path covers the whole site; hosts are exact unless the pattern says *.", () => {
  // Same as Rails' Templates::Matcher: only "www." is ignored.
  const t = entry("hemnet.se", "/");
  assert.ok(templateMatchesUrl(t, "https://www.hemnet.se/bostader?x=1"));
  assert.ok(!templateMatchesUrl(t, "https://m.hemnet.se/"));
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

test("registers exactly unblock_fetch, find_templates and get_build_guide", async () => {
  const server = createServer(new UnblockingApiClient({ apiKey: "" }));
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);

  assert.equal(client.getServerVersion()?.version, VERSION);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["find_templates", "get_build_guide", "unblock_fetch"]);

  const fetchTool = tools.find((t) => t.name === "unblock_fetch")!;
  assert.deepEqual(fetchTool.inputSchema.required, ["url"]);
  for (const p of ["url", "render", "location", "wait_for", "settle_ms", "wait_rules", "detect_ms",
    "wait_state", "scroll_steps", "wait_min_ms", "max_age", "template", "format", "select", "fresh", "max_chars"]) {
    assert.ok(p in (fetchTool.inputSchema.properties ?? {}), `unblock_fetch.${p}`);
  }
  const find = tools.find((t) => t.name === "find_templates")!;
  assert.deepEqual(Object.keys(find.inputSchema.properties ?? {}).sort(), ["category", "limit", "page", "search", "url"]);

  const guide = tools.find((t) => t.name === "get_build_guide")!;
  assert.deepEqual(guide.inputSchema.required, ["topic"]);

  // The guides are read from guides/ next to the code: every topic must exist.
  const { GUIDE_TOPICS } = await import("../src/guides.js");
  for (const { topic } of GUIDE_TOPICS) {
    const res = await client.callTool({ name: "get_build_guide", arguments: { topic } });
    assert.ok(!res.isError, `guide ${topic}`);
  }

  await client.close();
});

test("server metadata stays in sync", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const serverJson = JSON.parse(await readFile(new URL("../server.json", import.meta.url), "utf8"));
  const plugin = JSON.parse(await readFile(new URL("../plugins/claude/.claude-plugin/plugin.json", import.meta.url), "utf8"));
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

// --- find_templates against the feed ---------------------------------------

function tpl(reference: string, host: string, path = "/", extra: Partial<TemplateEntry> = {}): TemplateEntry {
  return { reference, api_name: reference.split("/")[1], name: reference, description: "", host, path, fields: [], ...extra } as TemplateEntry;
}

/** Stub fetch: /templates.json answers `feed(url)`, anything else 404s. Returns the feed URLs asked for. */
function stubFetch(feed: (url: URL) => object): { calls: URL[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.endsWith("/templates.json")) return new Response("{}", { status: 404 });
    calls.push(url);
    return new Response(JSON.stringify(feed(url)), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function findTemplates(args: Record<string, unknown>): Promise<string> {
  const server = createServer(new UnblockingApiClient({ apiKey: "" }));
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const res = await client.callTool({ name: "find_templates", arguments: args });
  await client.close();
  assert.ok(!res.isError, JSON.stringify(res.content));
  return (res.content as { text: string }[])[0].text;
}

test("find_templates asks the API to match, and reports the server's total", async () => {
  resetTemplateCaches();
  const stub = stubFetch(() => ({
    categories: [{ slug: "seo", name: "SEO", group: "", description: "", templates_count: 300 }],
    templates: [tpl("them/rare", "shop.example", "/p/*")],
    total: 1, page: 1, limit: 25,
  }));
  try {
    const text = await findTemplates({ url: "https://shop.example/p/1", search: "shop", category: "seo" });
    assert.equal(stub.calls.length, 1);
    const q = stub.calls[0].searchParams;
    assert.equal(q.get("url"), "https://shop.example/p/1");
    assert.equal(q.get("q"), "shop");
    assert.equal(q.get("category"), "seo");
    assert.equal(q.get("limit"), "25");
    assert.equal(q.get("page"), "1");
    assert.match(text, /^1 template\(s\) match:/);
    assert.match(text, /them\/rare/);
    assert.doesNotMatch(text, /may hold more/);

    // The same question again is answered from the cache.
    await findTemplates({ url: "https://shop.example/p/1", search: "shop", category: "seo" });
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test("find_templates says when more match than it shows, and pages on", async () => {
  resetTemplateCaches();
  const stub = stubFetch((url) => ({
    categories: [],
    templates: [tpl(`them/t${url.searchParams.get("page")}`, "x.example")],
    total: 3, page: Number(url.searchParams.get("page")), limit: 1,
  }));
  try {
    const first = await findTemplates({ search: "x", limit: 1 });
    assert.match(first, /^3 template\(s\) match, showing 1–1 — narrow with search\/category, raise limit or pass page: 2:/);
    const last = await findTemplates({ search: "x", limit: 1, page: 3 });
    assert.match(last, /showing 3–3 — narrow with search\/category:/);
    assert.equal(stub.calls.at(-1)!.searchParams.get("page"), "3");
  } finally {
    stub.restore();
  }
});

test("find_templates falls back to filtering an older API's list itself, and flags a capped list", async () => {
  resetTemplateCaches();
  // An API without server-side search: ignores url/q/page, no `total`.
  const filler = Array.from({ length: 199 }, (_, i) => tpl(`them/f${i}`, `f${i}.example`));
  const stub = stubFetch(() => ({ categories: [], templates: [...filler, tpl("them/google", "google.com", "/search")] }));
  try {
    const text = await findTemplates({ url: "https://www.google.com/search?q=x" });
    assert.match(text, /^1 template\(s\) match:/);
    assert.match(text, /them\/google/);
    assert.match(text, /only the 200 most-used templates could be searched/);
    const legacy = stub.calls.at(-1)!.searchParams;
    assert.equal(legacy.get("limit"), "200");
    assert.equal(legacy.get("url"), null);

    // Known to be an older API now: no second probe with filters.
    const before = stub.calls.length;
    const miss = await findTemplates({ url: "https://nothing.example/" });
    assert.match(miss, /^No template covers https:\/\/nothing\.example\//);
    assert.equal(stub.calls.length, before);
  } finally {
    stub.restore();
  }
});

test("the free re-read window is stated from the page cache's TTL, and max_age is not sold as free", async () => {
  const { PAGE_CACHE_TTL_MS } = await import("../src/page.js");
  const minutes = `${PAGE_CACHE_TTL_MS / 60_000} minutes`;
  const server = createServer(new UnblockingApiClient({ apiKey: "" }));
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const instructions = client.getInstructions() ?? "";
  assert.ok(instructions.includes(`within ${minutes} is free`), instructions);
  assert.match(instructions, /max_age .* still costs 1 credit/);
  const { tools } = await client.listTools();
  const fresh = tools.find((t) => t.name === "unblock_fetch")!.inputSchema.properties!.fresh as { description: string };
  assert.ok(fresh.description.includes(`last ${minutes}`), fresh.description);
  await client.close();
});

test("plugin skills bundle the current build guides", async () => {
  const { readFile } = await import("node:fs/promises");
  const bundled: Record<string, string[]> = {
    "build-app": ["api", "fetch-tuning"],
    templates: ["templates"],
    "app-recipes": ["rank-tracker", "price-monitor", "listings-aggregator"],
  };
  const covered = Object.values(bundled).flat().sort();
  assert.deepEqual(covered, GUIDE_TOPICS.map((g) => g.topic).sort(), "every guide belongs to one skill");
  for (const [skill, topics] of Object.entries(bundled)) {
    for (const topic of topics) {
      const guide = await readFile(new URL(`../guides/${topic}.md`, import.meta.url), "utf8");
      const copy = await readFile(new URL(`../plugins/claude/skills/${skill}/references/${topic}.md`, import.meta.url), "utf8");
      assert.equal(copy, guide, `plugins/claude/skills/${skill}/references/${topic}.md is stale: copy guides/${topic}.md over it`);
    }
  }
});

test("an interactive verification is named by its vendor", async () => {
  const notesFor = async (vendor: string) => {
    const api = new UnblockingApiClient({ apiKey: "k" });
    api.unblock = async () =>
      ({
        job_id: "j", url: "https://example.com/", status: "succeeded", http_response_code: 200, response_time_ms: 1,
        render: true, location: null, response_format: "html", response: "<p>hi</p>",
        readiness: { status: "satisfied", verification: { vendor, status: "interactive" } },
      }) as unknown as Awaited<ReturnType<UnblockingApiClient["unblock"]>>;
    const server = createServer(api);
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const res = await client.callTool({ name: "unblock_fetch", arguments: { url: `https://example.com/${vendor}` } });
    await client.close();
    return (res.content as { text: string }[]).map((c) => c.text).join("\n");
  };
  assert.match(await notesFor("datadome"), /shows a DataDome check that needs a human/);
  assert.match(await notesFor("google"), /shows Google's bot check that needs a human/);
  assert.doesNotMatch(await notesFor("recaptcha"), /Turnstile/);
  assert.match(await notesFor("somethingnew"), /shows a bot check that needs a human/);
});
