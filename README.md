# @unblockingapi/mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server and
Claude Code plugin for [UnblockingAPI](https://unblockingapi.com). Gives AI
agents (Claude, Cursor, VS Code, Zed, …) a real browser behind rotating
residential proxies: fetch bot-protected and JavaScript-heavy pages, run
Google searches, and parse sites into structured JSON with published templates.

## Tools

| Tool | What it does | Cost |
| --- | --- | --- |
| `unblock_fetch` | Fetch any URL, bypassing anti-bot walls, CAPTCHAs and geo-blocks. Plain HTTP by default, `render: true` for a real browser. Pass `template` to get JSON instead of HTML. | 1 credit per success |
| `google_search` | Google search → JSON (`query`, `results[{position,title,description,url}]`, `related_searches`). | 1 credit |
| `list_templates` | Browse the published structured-data templates (search engines, property portals, business directories, …) with an example call for each. | free |

Failed requests are free. The server also ships instructions and a skill so the
agent starts with a plain fetch and only renders when a page needs JavaScript.

## Setup

You need an UnblockingAPI key — sign up at <https://unblockingapi.com> (500 free
credits, no card).

Detailed guides: **[Claude](docs/claude.md)** (Claude Code plugin, `claude mcp add`,
Claude Desktop) · **[Cursor](docs/cursor.md)** · other clients below.

### Claude Code — plugin (recommended)

The plugin bundles the MCP server, asks for your key on install, and makes
Claude use `unblock_fetch` instead of its built-in web fetch.

```bash
claude plugin marketplace add unblockingapi/mcp
claude plugin install unblockingapi@unblockingapi-plugins
```

Or inside Claude Code: `/plugin marketplace add unblockingapi/mcp`, then
`/plugin install unblockingapi@unblockingapi-plugins`.

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
`.cursor/mcp.json`. See [docs/cursor.md](docs/cursor.md) for the one-click
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
| `UNBLOCKINGAPI_GOOGLE_TEMPLATE` | no | `kjellberg/google-search` | Template `google_search` parses results with. |

## Usage

Once connected, ask your agent things like:

- *"Read https://example.com/pricing and summarise the plans."*
  → `unblock_fetch(url)` — then `render: true` if the page turned out to need JavaScript
- *"What are the top Google results for 'best running shoes' in the US?"*
  → `google_search(q: "best running shoes", location: "us")`
- *"Which sites have a structured template?"* → `list_templates()`
- *"Pull the company profile at this allabolag.se URL as JSON."*
  → `unblock_fetch(url, template: "kjellberg/allabolag")`

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
| `template` | string | Parse with a published template (`handle/name`) and return JSON. Forces that template's fetch settings. |
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
