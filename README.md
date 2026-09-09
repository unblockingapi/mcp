# @unblockingapi/mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server and
Claude Code plugin for [UnblockingAPI](https://unblockingapi.com). Gives AI
agents (Claude, Cursor, VS Code, Zed, …) a real browser behind rotating
residential proxies: fetch bot-protected and JavaScript-heavy pages, and parse
any site a published template covers into structured JSON.

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `unblock_fetch` | Fetch any URL, bypassing anti-bot walls, CAPTCHAs and geo-blocks. Plain HTTP by default, `render: true` for a real browser. Pass `template` to get structured JSON instead of HTML. | 1 credit per success |
| `find_templates` | Find a template that parses a site into JSON — by the URL you are about to fetch, by keyword, or by category. | free |

Failed requests are free. The server also ships instructions and a skill so the
agent starts with a plain fetch, renders only when a page needs JavaScript, and
checks for a template before parsing a known site by hand.

### Templates

A template turns a page into named fields instead of markup. The catalogue is
open-ended — search engines, marketplaces, property portals, company registries
— and anyone can publish one from the [editor](https://editor.unblockingapi.com).
There is no special handling for any particular site: every template, official
or community, is reached the same way.

```
find_templates(url: "https://www.allabolag.se/foretag/…")   → kjellberg/allabolag
unblock_fetch(url: "…", template: "kjellberg/allabolag")     → { company_title, turnover, … }
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
without one, so skipping it leaves every fetch failing. From a terminal you can
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

### ChatGPT and other remote-only clients

ChatGPT connectors need a public HTTPS MCP endpoint. Bridge the stdio server
with [`supergateway`](https://github.com/supercorp-ai/supergateway) and a tunnel:

```bash
UNBLOCKINGAPI_KEY=your_api_key_here \
  npx -y supergateway --stdio "npx -y @unblockingapi/mcp" --port 8000
# then e.g. cloudflared tunnel --url http://localhost:8000 → add https://…/sse in ChatGPT
```

### Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `UNBLOCKINGAPI_KEY` | yes | — | Your API key. (The Claude Code plugin supplies it from its config prompt.) |
| `UNBLOCKINGAPI_BASE_URL` | no | `https://api.unblockingapi.com` | Override the API base URL. |
| `UNBLOCKINGAPI_TIMEOUT_MS` | no | `150000` | Per-request timeout. Rendered fetches can take up to 140 s. |

## Usage

Once connected, ask your agent things like:

- *"Read https://example.com/pricing and summarise the plans."*
  → `unblock_fetch(url)` — then `render: true` if the page turned out to need JavaScript
- *"Pull the company profile at this allabolag.se URL as JSON."*
  → `find_templates(url)` → `unblock_fetch(url, template: "kjellberg/allabolag")`
- *"Is there a template for this site?"* → `find_templates(url)`
- *"What can this parse into JSON?"* → `find_templates(category: "real-estate")`

### `unblock_fetch` parameters

| Param | Type | Notes |
| --- | --- | --- |
| `url` | string, required | http(s) only; media/binary files are rejected. |
| `render` | boolean | Run a real browser (executes JavaScript). Default `false`. |
| `location` | string | 2-letter country code for the proxy (`us`, `gb`, `de`, …). Any ISO country. |
| `wait_for` | string | Render-only. `stable` (default), `domcontentloaded`, `networkidle`, or a CSS selector to wait for. |
| `settle_ms` | 0–25000 | Render-only. Ceiling on the settle wait (default 5000) — capture happens as soon as the DOM is quiet for 500 ms. |
| `wait_rules` | array | Render-only. `[{if: "#consent", then: "#results"}]` — first visible `if` wins and its `then` replaces `wait_for`. |
| `detect_ms` | 0–25000 | Render-only. How long to probe `wait_rules` (default 800). |
| `max_age` | 0–300 | Accept a cached copy this many seconds old. Hits return in ms and carry `cached: true`. |
| `template` | string | Parse with a published template (`handle/name`) and return JSON. Forces that template's fetch settings. Find one with `find_templates`. |
| `max_chars` | integer | Cap on returned body (default 120000). Longer bodies are truncated with a note. |

Responses start with a JSON metadata block (`job_id`, `status`, `http_response_code`,
`response_time_ms`, `render`, `location`, `cached`, `parse_error`, `truncated`, …),
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
```

Repository layout: `src/` (server + API client), `.claude-plugin/` (Claude Code
plugin + marketplace manifests), `hooks/` and `skills/` (plugin behaviour),
`docs/` (setup guides).

## License

MIT
