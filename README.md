# @unblockingapi/mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server and
Claude Code plugin for [UnblockingAPI](https://unblockingapi.com). Gives AI
apps (Claude, Cursor, VS Code, Lovable, Replit, …) a real browser behind
rotating residential proxies: fetch bot-protected and JavaScript-heavy pages,
and parse any site a published template covers into structured JSON.

**Hosted at `https://mcp.unblockingapi.com/mcp`** — add it as a connector and
sign in, no install. Or run it locally with `npx -y @unblockingapi/mcp`.

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `unblock_fetch` | Fetch any URL, bypassing anti-bot walls, CAPTCHAs and geo-blocks. Picks plain HTTP or a real browser per site by itself. Returns Markdown (or HTML), optionally narrowed with a CSS `select`; pass `template` to get structured JSON instead. | 1 credit per success; re-reading the same fetch is free |
| `find_templates` | Find a template that parses a site into JSON — by the URL you are about to fetch, by keyword, or by category — with its output shape. | free |
| `get_build_guide` | Guides for building apps on the REST API with plain HTTP: API reference, getting complete pages, templates, and recipes (rank tracker, listings aggregator, price monitor). | free |

Failed requests are free. The server's instructions, tool descriptions and the
notes in each response steer the agent: let the API choose plain fetch or
browser, check for a template before parsing a known site, scroll or wait when
content is missing, and read the build guide before writing code that calls the API.

### Templates

A template turns a page into named fields instead of markup. The catalogue is
open-ended — search engines, marketplaces, property portals, company registries
— and anyone can publish one from the [editor](https://editor.unblockingapi.com).
There is no special handling for any particular site: every template, official
or community, is reached the same way.

```
find_templates(url: "https://www.google.com/search?q=…")   → kjellberg/google-search
unblock_fetch(url: "…", template: "kjellberg/google-search") → { query, results, related_searches }
```

If a parser fails because the site changed, you get raw HTML back with
`parse_error: true` rather than an error.

## Setup

You need an UnblockingAPI account — sign up at <https://unblockingapi.com> (500
free credits, no card). Then pick one:

1. **[Hosted server](#hosted-server)** — paste one URL into your app and sign in.
   Nothing to install, no key to copy. Recommended for most apps.
2. **[Claude Code plugin](#claude-code-plugin)** — the hosted tools plus a hook
   that makes `unblock_fetch` Claude Code's web fetch.
3. **[Run it locally](#run-it-locally)** — the same server over stdio with `npx`,
   for those who prefer to run it themselves.

### Hosted server

```
https://mcp.unblockingapi.com/mcp
```

Streamable HTTP. Apps that support MCP sign-in (OAuth) only need the URL: they
open an UnblockingAPI page where you sign in and click *Allow*. The app never
sees your key, and you can disconnect it any time under *Settings → Connected
apps* at app.unblockingapi.com. Apps without sign-in send your key as
`Authorization: Bearer <key>` (or `X-Api-Key: <key>`).

| App | How | Guide |
| --- | --- | --- |
| Claude.ai, Claude Desktop | *Customize → Connectors → + Add → Add custom connector*, paste the URL, *Connect* | [unblockingapi.com/tools/claude](https://unblockingapi.com/tools/claude) |
| Cursor | One-click link, or `"url"` in `~/.cursor/mcp.json`, then *Login* under Settings → MCP | [docs/cursor-setup.md](docs/cursor-setup.md) · [site](https://unblockingapi.com/tools/cursor) |
| VS Code (Copilot) | `code --add-mcp '{"name":"unblockingapi","type":"http","url":"https://mcp.unblockingapi.com/mcp"}'`, sign in on first use | [site](https://unblockingapi.com/tools/vscode) |
| Windsurf | `"serverUrl"` in the MCP config (Cascade → MCPs → Open MCP config file) | [site](https://unblockingapi.com/tools/windsurf) |
| Lovable | *Connectors → + → MCP server*, OAuth | [site](https://unblockingapi.com/tools/lovable) |
| Replit | *Integrations → MCP Servers → + Add MCP server*, *Test & save* | [site](https://unblockingapi.com/tools/replit) |
| Bolt | *Connectors → Manage connectors → Custom MCP server*, transport HTTP, MCP OAuth | [site](https://unblockingapi.com/tools/bolt) |
| Zed | `"url"` (+ `"headers"`) under `context_servers` | [site](https://unblockingapi.com/tools/zed) |
| Cline | Remote Servers tab, `"type": "streamableHttp"` + key header | [site](https://unblockingapi.com/tools/cline) |
| Gemini CLI / Antigravity | `gemini mcp add --transport http …` / `"serverUrl"` + key header | [site](https://unblockingapi.com/tools/gemini-cli) |
| Claude API | `mcp_servers` entry, your key as `authorization_token` | [site](https://unblockingapi.com/tools/claude-api) |
| n8n | MCP Client Tool, HTTP Streamable, Bearer Auth | [site](https://unblockingapi.com/tools/n8n) |

With a key instead of signing in:

```bash
# Claude Code
claude mcp add --transport http unblockingapi https://mcp.unblockingapi.com/mcp \
  --header "Authorization: Bearer your_api_key_here"
```

```json
{
  "mcpServers": {
    "unblockingapi": {
      "url": "https://mcp.unblockingapi.com/mcp",
      "headers": { "Authorization": "Bearer your_api_key_here" }
    }
  }
}
```

(Some apps name the URL key `serverUrl` or `httpUrl`; VS Code uses `servers`
with `"type": "http"`.) Agent frameworks: see
[Vercel AI SDK and LangChain](https://unblockingapi.com/guides/connect-ai-agent-frameworks-to-the-web).

### Claude Code plugin

The plugin bundles the MCP server, stores your key, and makes Claude use
`unblock_fetch` instead of its built-in web fetch. In Claude Code:

```
/plugin marketplace add unblockingapi/mcp
/plugin install unblockingapi@unblockingapi-plugins
/plugin configure unblockingapi@unblockingapi-plugins
```

**The third line matters.** Installing does not prompt for your key and succeeds
without one, so skipping it leaves every fetch failing. New to this? Run
`/unblockingapi:setup` instead and Claude walks you through it, then checks that
it works. Full walkthrough: [docs/claude-setup.md](docs/claude-setup.md).

### Run it locally

The same server over stdio. Needs Node.js 18+ and your key in
`UNBLOCKINGAPI_KEY`.

```bash
# Claude Code
claude mcp add unblockingapi -e UNBLOCKINGAPI_KEY=your_api_key_here -- npx -y @unblockingapi/mcp

# VS Code
code --add-mcp '{"name":"unblockingapi","command":"npx","args":["-y","@unblockingapi/mcp"],"env":{"UNBLOCKINGAPI_KEY":"your_api_key_here"}}'
```

Claude Desktop (`claude_desktop_config.json`; restart after editing), Cursor
(`~/.cursor/mcp.json`) and most other apps take this block:

```json
{
  "mcpServers": {
    "unblockingapi": {
      "command": "npx",
      "args": ["-y", "@unblockingapi/mcp"],
      "env": { "UNBLOCKINGAPI_KEY": "your_api_key_here" }
    }
  }
}
```

Agentic clients that edit their own config will also set it up if you ask:
"Install the `@unblockingapi/mcp` MCP server. My API key is `sk_xxx`. It runs over
stdio via `npx -y @unblockingapi/mcp` and needs the env var `UNBLOCKINGAPI_KEY`."

### Environment variables (local server)

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `UNBLOCKINGAPI_KEY` | yes | — | Your API key. (The Claude Code plugin supplies it from its config prompt.) |
| `UNBLOCKINGAPI_BASE_URL` | no | `https://api.unblockingapi.com` | Override the API base URL. |
| `UNBLOCKINGAPI_TIMEOUT_MS` | no | `180000` | Per-request timeout. A plain fetch that falls back to a browser can take ~170 s. |

## Usage

Once connected, ask your agent things like:

- *"Read https://example.com/pricing and summarise the plans."*
  → `unblock_fetch(url)` — the API renders it in a browser if the site needs one
- *"Get the Google results for 'wikipedia' as JSON."*
  → `find_templates(url)` → `unblock_fetch(url, template: "kjellberg/google-search")`
- *"Is there a template for this site?"* → `find_templates(url)`
- *"What can this parse into JSON?"* → `find_templates(category: "real-estate")`

### `unblock_fetch` parameters

| Param | Type | Notes |
| --- | --- | --- |
| `url` | string, required | http(s) only; media/binary files are rejected. |
| `render` | boolean | Omit to let the API decide (plain first, browser when blocked or a JS shell; learned per site). `true` always renders, `false` never. |
| `location` | string | 2-letter country code for the proxy (`us`, `gb`, `de`, …). An unsupported one is refused with the list. |
| `wait_for` | string | Implies a browser. `stable` (default), `domcontentloaded`, `networkidle`, or a CSS selector to wait for. |
| `wait_state` | enum | With a selector `wait_for`: `visible` (default), `nonempty`, `hidden`, `stable`. |
| `scroll_steps` | 0–10 | Implies a browser. Scroll this many times before the readiness check (lazy content). |
| `wait_min_ms` | 0–10000 | Implies a browser. Minimum delay after navigation. |
| `settle_ms` | 0–25000 | Implies a browser. Ceiling on the settle wait (default 5000) — capture happens as soon as the DOM is quiet for 500 ms. |
| `wait_rules` | array | Implies a browser. `[{if: "#consent", then: "#results"}]` — first visible `if` wins and its `then` replaces `wait_for`. |
| `detect_ms` | 0–25000 | Implies a browser. How long to probe `wait_rules` (default 800). |
| `max_age` | 0–300 | Accept a cached copy this many seconds old. Hits return in ms and carry `cached: true`. |
| `template` | string | Parse with a published template (`handle/name`, or `handle/name@3` to pin a version) and return JSON. Forces that template's fetch settings. Find one with `find_templates`. |
| `format` | `markdown` \| `html` | How the page comes back (default `markdown`: a fraction of the size). Template results are always JSON. |
| `select` | string | CSS selector: return only the matching elements, in `format`. |
| `fresh` | boolean | Fetch again even if this exact fetch was made in the last 10 minutes. By default that copy is reused — so re-reading it with another `select` or `format` costs nothing. |
| `max_chars` | integer | Cap on returned body (default 120000), after `format`/`select`. Longer bodies are cut with a note. |

Responses start with a JSON metadata block (`job_id`, `status`, `http_response_code`,
`response_time_ms`, `render`, `render_reason`, `readiness`, `template_version`, `location`, `cached`, `parse_error`, `truncated`, …),
then notes on what to try next (scroll for more, a narrower `select`, …), then `---`
and the Markdown, HTML or JSON body. API errors (bad key, out of credits,
unknown template, invalid params, concurrency limit) come back as clear tool errors.

Full API reference: <https://unblockingapi.com/docs>.

## Development

```bash
npm install
npm run dev        # tsx watch
npm run typecheck  # tsc --noEmit
npm run build      # compile to dist/
npm run smoke      # drive the built server over stdio (add UNBLOCKINGAPI_KEY for live fetches)
npm run smoke:http # the same over HTTP against dist/http.js (or MCP_URL=https://mcp.unblockingapi.com/mcp)
npm run start:http # the hosted server on :8080 (PORT)
```

Repository layout: `src/` (`server.ts` tools, `index.ts` stdio entry,
`http.ts` hosted entry, `client.ts` API client), `Dockerfile` (the hosted
image, deployed to mcp.unblockingapi.com by `.github/workflows/deploy.yml`), `.claude-plugin/` (Claude Code
plugin + marketplace manifests), `hooks/`, `skills/` and `commands/` (plugin
behaviour), `docs/` (setup guides).

## License

MIT
