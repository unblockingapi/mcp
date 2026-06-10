# @unblockingapi/mcp

Official [Model Context Protocol](https://modelcontextprotocol.io) server for
[UnblockingAPI](https://unblockingapi.com). Gives AI agents (Claude, Cursor,
OpenClaw, …) the ability to fetch bot-protected and JavaScript-heavy web pages
and run structured Google searches — all through UnblockingAPI's anti-detection
engine and rotating residential proxies.

## Tools

| Tool | What it does |
| --- | --- |
| `unblock_fetch` | Fetch any URL, bypassing anti-bot/CAPTCHA/geo-blocks. Optional headless-browser rendering for SPAs and dynamic pages. Returns HTML. |
| `google_search` | Run a Google search and get structured organic results as JSON. |

> More tools (e.g. Ahrefs website authority) will be added as additional API
> templates go live.

## Setup

You need an UnblockingAPI key — get one at <https://unblockingapi.com>.

### Claude Desktop / Claude Code

Add to your MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "unblockingapi": {
      "command": "npx",
      "args": ["-y", "@unblockingapi/mcp"],
      "env": {
        "UNBLOCKINGAPI_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `UNBLOCKINGAPI_KEY` | yes | — | Your API key. |
| `UNBLOCKINGAPI_BASE_URL` | no | `https://api.unblockingapi.com` | Override the API base URL. |
| `UNBLOCKINGAPI_TIMEOUT_MS` | no | `45000` | Per-request timeout. Rendered fetches can take ~35s. |

## Usage examples

Once connected, ask your agent things like:

- *"Fetch the rendered HTML of https://example.com using a German proxy."*
  → `unblock_fetch(url, render: true, location: "de")`
- *"Get the Google results for 'best running shoes' in the US."*
  → `google_search(q: "best running shoes", location: "us")`
- *"What's the domain authority of ahrefs.com?"*
  → `ahrefs_website_authority(domain: "ahrefs.com")`

### `unblock_fetch` parameters

- `url` (required) — HTTP/HTTPS URL. Media/binary files are rejected.
- `render` — render with a headless browser (runs JS). Default `false`.
- `location` — 2-letter country code for the proxy (`us`, `gb`, `de`, …).
- `wait` — render-only. Comma-separated wait steps (max 5): a leading load event
  (`domcontentloaded`|`load`|`networkidle`), then CSS selectors or
  `networkidle:<ms>` / `domstable:<ms>` strategies. e.g. `domcontentloaded,h3`.
- `block_assets` — render-only. Skip images/CSS/fonts for a faster fetch.
- `remove_scripts` / `remove_stylesheets` / `remove_svgs` — strip those tags from
  the returned HTML.

## Development

```bash
npm install
npm run dev        # tsx watch
npm run typecheck  # tsc --noEmit
npm run build      # compile to dist/
```

## License

MIT
