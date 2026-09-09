# Changelog

## 0.3.0 — 2026-09-09

Rewritten against the current `/unblock` API.

### Breaking

- **`google_search` no longer calls `/api/google-search`** (the endpoint was removed and the old tool 404'd). It now builds the Google URL and calls `/unblock` with the published `kjellberg/google-search` template; the JSON shape is `{ query, results[{position,title,description,url}], related_searches[] }`. New `language` (`hl=`) parameter; `uule` was dropped.
- **`idealista_property` removed** — that template no longer exists. Use `list_templates` to discover what is published, then `unblock_fetch` with `template=`.
- **`unblock_fetch` parameters follow the new wait model**: `wait` → `wait_for` (`stable` | `domcontentloaded` | `networkidle` | CSS selector) plus `settle_ms`, `wait_rules` and `detect_ms`. `block_assets`, `remove_scripts`, `remove_stylesheets` and `remove_svgs` are gone: the API always blocks presentational assets on renders and always strips those tags.
- Default request timeout raised from 70 s to **150 s** (rendered fetches can run up to 140 s server-side).

### Added

- `list_templates` tool (free, keyless): browse published structured-data templates, filter by category or search term, with a ready-to-use example call for each.
- `template` and `max_age` (0–300 s response cache) parameters on `unblock_fetch`, and `max_chars` to cap how much body is returned to the model.
- Server instructions and a "this page looks like it needs JavaScript" hint on thin plain fetches, so agents start with `render=false` and escalate only when needed.
- Clear errors for every API gate: 401 (key), 402 (credits), 404 (unknown template), 422 (parameters), 429 (concurrency), 503 (warming up). `parse_error` and `cached` are surfaced in the result metadata.
- **Claude Code plugin** (`.claude-plugin/`): `claude plugin marketplace add unblockingapi/mcp` then `claude plugin install unblockingapi@unblockingapi-plugins`. Prompts for the API key on install, bundles a skill that makes Claude use `unblock_fetch` instead of the built-in fetch, and a hook that redirects `WebFetch` calls to it.
- `npm run smoke`: drives the built server over stdio (tool list, keyless catalogue, error paths; live fetches when `UNBLOCKINGAPI_KEY` is set).
- Setup guides: [docs/claude.md](docs/claude.md) and [docs/cursor.md](docs/cursor.md).

### Changed

- Tools are registered with `registerTool` and read-only annotations; MCP SDK `^1.30`, zod `^3.25`.
- Requests go out as `POST /unblock` with a JSON body (so `wait_rules` is a real array).

## 0.2.0

- `idealista_property` tool, new `block_assets` default, 70 s timeout.

## 0.1.0

- Initial release: `unblock_fetch`, `google_search`, `ahrefs_website_authority`.
