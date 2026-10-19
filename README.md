# @unblockingapi/mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server and
Claude Code plugin for [UnblockingAPI](https://unblockingapi.com). Gives AI
agents (Claude, Cursor, VS Code, Zed, …) a real browser behind rotating
residential proxies: fetch bot-protected and JavaScript-heavy pages, and parse
any site a published template covers into structured JSON.

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `unblock_fetch` | Fetch any URL, bypassing anti-bot walls, CAPTCHAs and geo-blocks. Picks plain HTTP or a real browser per site by itself; `render` forces one. Pass `template` to get structured JSON instead of HTML. | 1 credit per success |
| `find_templates` | Find a template that parses a site into JSON — by the URL you are about to fetch, by keyword, or by category. | free |

Failed requests are free. The server also ships instructions and a skill so the
agent lets the API choose plain fetch or browser per site, and
checks for a template before parsing a known site by hand.

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

You need an UnblockingAPI key — sign up at <https://unblockingapi.com> (500 free
credits, no card).

Detailed guides: **[Claude](docs/claude-setup.md)** (Claude Code plugin, `claude mcp add`,
Claude Desktop) · **[Cursor](docs/cursor-setup.md)** · other clients below.

### Claude Code — plugin (recommended)

The plugin bundles the MCP server, stores your key, and makes Claude use
`unblock_fetch` instead of its built-in web fetch.

In Claude Code, three lines:

```
/plugin marketplace add unblockingapi/mcp
/plugin install unblockingapi@unblockingapi-plugins
/plugin configure unblockingapi@unblockingapi-plugins
```

**The third line matters.** Installing does not prompt for your key and succeeds
without one, so skipping it leaves every fetch failing. New to this? Run
`/unblockingapi:setup` instead and Claude walks you through it, then checks that
it works. From a terminal you can
do it in one shot instead, but `--config` only applies on a fresh install:

```bash
claude plugin install unblockingapi@unblockingapi-plugins --config api_key=your_api_key_here
```

Full walkthrough: [docs/claude-setup.md](docs/claude-setup.md).

### Claude Code — plain MCP server

```bash
claude mcp add unblockingapi \
  -e UNBLOCKINGAPI_KEY=your_api_key_here \
  -- npx -y @unblockingapi/mcp
```

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`), then restart Claude:

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

### Cursor

Add the same block to `~/.cursor/mcp.json` (every project) or a project's
`.cursor/mcp.json`. See [docs/cursor-setup.md](docs/cursor-setup.md) for the one-click
install link and a rule that makes the agent prefer `unblock_fetch`.

### VS Code (Copilot agent mode)

```bash
code --add-mcp '{"name":"unblockingapi","command":"npx","args":["-y","@unblockingapi/mcp"],"env":{"UNBLOCKINGAPI_KEY":"your_api_key_here"}}'
```

### Install by prompt

Agentic clients that can edit their own config (Claude Code, Cursor's agent,
Cline, …) will set it up if you ask:

> Install the `@unblockingapi/mcp` MCP server. My API key is `sk_xxx`. It runs
> over stdio via `npx -y @unblockingapi/mcp` and needs the env var
> `UNBLOCKINGAPI_KEY`.

### Hosted server

No Node, no install: connect to `https://mcp.unblockingapi.com/mcp`
(Streamable HTTP). Same tools, same credits. Sign in with your UnblockingAPI
account, or send your key as a header.

**Claude.ai and Claude Desktop:** Settings → Connectors → *Add custom
connector*, paste `https://mcp.unblockingapi.com/mcp`, then *Connect* and allow
access on the UnblockingAPI page that opens. No key to copy; you can disconnect
it any time under Settings → *Connected apps* at app.unblockingapi.com.

Clients that support OAuth do the same when you add the URL without a header.
With a key instead:

```bash
# Claude Code
claude mcp add --transport http unblockingapi https://mcp.unblockingapi.com/mcp \
  --header "Authorization: Bearer your_api_key_here"

# VS Code
code --add-mcp '{"name":"unblockingapi","type":"http","url":"https://mcp.unblockingapi.com/mcp","headers":{"Authorization":"Bearer your_api_key_here"}}'
```

Cursor, Windsurf and other clients that take a URL plus headers:

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

`X-Api-Key: your_api_key_here` works too. The local server is still the better
fit for the Claude Code plugin, which also redirects Claude's built-in web
fetch.

### Environment variables

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
| `max_chars` | integer | Cap on returned body (default 120000). Longer bodies are truncated with a note. |

Responses start with a JSON metadata block (`job_id`, `status`, `http_response_code`,
`response_time_ms`, `render`, `render_reason`, `readiness`, `template_version`, `location`, `cached`, `parse_error`, `truncated`, …),
then `---`, then the HTML or JSON body. API errors (bad key, out of credits,
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
