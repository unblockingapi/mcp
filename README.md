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
| `idealista_property` | Extract structured data from an idealista.com property listing (price, size, rooms, energy rating, features, photos, …) as JSON. |

> More tools (e.g. Ahrefs website authority) will be added as additional API
> templates go live.

### A note on rendering & `block_assets`

When you set `render: true`, the page is rendered in a real browser and **JavaScript
always executes** — so SPAs and dynamic content come back fully rendered. By default
the renderer **skips downloading CSS, images, fonts, and media** (`block_assets`
defaults to `true` on renders) for speed and lower cost; this does not affect the
DOM/text you get back. Pass `block_assets: false` only when you actually need those
assets (e.g. image URLs or a visually complete page).

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
- *"Pull the details of this idealista listing: https://www.idealista.com/inmueble/111072490/"*
  → `idealista_property(url: "https://www.idealista.com/inmueble/111072490/")`

### `unblock_fetch` parameters

- `url` (required) — HTTP/HTTPS URL. Media/binary files are rejected.
- `render` — render with a headless browser (runs JS). Default `false`.
- `location` — 2-letter country code for the proxy (`us`, `gb`, `de`, …).
- `wait` — render-only. Comma-separated wait steps (max 5): a leading load event
  (`domcontentloaded`|`load`|`networkidle`), then CSS selectors or
  `networkidle:<ms>` / `domstable:<ms>` strategies. e.g. `domcontentloaded,h3`.
- `block_assets` — render-only. Defaults to `true` on renders (skips CSS/images/fonts/media
  for speed; JS still runs). Pass `false` to also download those assets. See note above.
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
