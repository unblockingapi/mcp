# Changelog

## 0.4.2 — 2026-09-10

### Fixed

- The "no key" error gave plugin users the wrong instruction — "set UNBLOCKINGAPI_KEY in the server's environment" rather than the `/plugin configure` command that actually applies. Plugin context was detected from `CLAUDE_PLUGIN_ROOT`, which `.mcp.json` expands but which is **not** exported into the server process, so the check silently failed for exactly the people who needed the right advice. The plugin's `.mcp.json` now sets its own `UNBLOCKINGAPI_PLUGIN` marker. Found by running the real plugin end to end; every isolated test had passed because the test set the variable itself.
- That message now also tells the user to reconnect the server from `/mcp` afterwards, since the key is read once at server start.

## 0.4.1 — 2026-09-09

Onboarding. Everything here landed after 0.4.0 was published to npm.

### Added

- **`/unblockingapi:setup`** — a guided setup command. It checks what is actually wrong (server not connected, no key stored, key invalid, out of credits) by calling the free template lookup and then a fetch, gives the user the one step that applies, and confirms it worked. It also warns that the key is read at server start, so a key saved mid-session needs a reconnect from `/mcp`.
- The "no key" error now says what to do *where you are*: inside the plugin it names `/plugin configure unblockingapi@unblockingapi-plugins`; elsewhere it points at `UNBLOCKINGAPI_KEY`. Installing a plugin never prompts for config, so this message is often the only thing standing between a keyless install and a stuck user.

### Changed

- The bundled skill is now **`unblock`** (was `web-fetching`), so it reads `unblockingapi:unblock`.
- README and the Claude guide lead with the three-line UI install and mark the configure step as mandatory, with the caveat that `--config` only applies on a *fresh* install and is silently ignored when the plugin is already installed.

### Known issues

- The keyless `/demo` endpoint returns 502 for every valid URL in production (an invalid URL still returns its normal 422, so the route itself is alive). Until that is fixed, the plugin cannot offer a no-key trial mode.

## 0.4.0 — 2026-09-09

Templates are the product surface; no site gets special treatment.

### Breaking

- **`google_search` removed.** A bespoke tool for one site does not scale to a catalogue meant to hold every site, and it pinned a template slug that went obsolete. Google is now reached the same way as everything else: build the URL, call `find_templates` with it, pass any match to `unblock_fetch`. The `UNBLOCKINGAPI_GOOGLE_TEMPLATE` environment variable is gone.
- **`list_templates` is now `find_templates`**, and takes a `url` — "is there a template for the page I am about to fetch?" is the question that actually comes up. Keyword (`search`), `category` and `limit` are still there; output is capped at 25 by default and reports how many matched out of the whole catalogue, so a large catalogue does not flood the context.

### Fixed

- The plugin passed only `${user_config.api_key}` to the server, so a plugin installed without `--config api_key=…` started with no key and every fetch failed. It now also accepts an exported `UNBLOCKINGAPI_KEY`.
- The `WebFetch` hook named a tool that does not exist (`mcp__plugin_unblockingapi_unblockingapi__unblock_fetch`); the real name is `mcp__unblockingapi__unblock_fetch`.
- `docs/claude.md` was renamed to `docs/claude-setup.md`: on a case-insensitive filesystem it collided with `CLAUDE.md` and was loaded as agent instructions.

## 0.3.0 — 2026-09-09

Rewritten against the current `/unblock` API.

### Breaking

- **`google_search` no longer calls `/api/google-search`** (the endpoint was removed and the old tool 404'd). It now builds the Google URL and calls `/unblock` with the published `kjellberg/google-search` template; the JSON shape is `{ query, results[{position,title,description,url}], related_searches[] }`. New `language` (`hl=`) parameter; `uule` was dropped.
- **`idealista_property` removed** — that template no longer exists. Use `list_templates` to discover what is published, then `unblock_fetch` with `template=`.
- **`unblock_fetch` parameters follow the new wait model**: `wait` → `wait_for` (`stable` | `domcontentloaded` | `networkidle` | CSS selector) plus `settle_ms`, `wait_rules` and `detect_ms`. `block_assets`, `remove_scripts`, `remove_stylesheets` and `remove_svgs` are gone: the API always blocks presentational assets on renders and always strips those tags.
- Default request timeout raised from 70 s to **150 s** (rendered fetches can run up to 140 s server-side).

### Added

- A free, keyless template-discovery tool.
- `template` and `max_age` (0–300 s response cache) parameters on `unblock_fetch`, and `max_chars` to cap how much body is returned to the model.
- Server instructions and a "this page looks like it needs JavaScript" hint on thin plain fetches, so agents start with `render=false` and escalate only when needed.
- Clear errors for every API gate: 401 (key), 402 (credits), 404 (unknown template), 422 (parameters), 429 (concurrency), 503 (warming up). `parse_error` and `cached` are surfaced in the result metadata.
- **Claude Code plugin** (`.claude-plugin/`): `claude plugin marketplace add unblockingapi/mcp` then `claude plugin install unblockingapi@unblockingapi-plugins`. Bundles a skill that makes Claude use `unblock_fetch` instead of the built-in fetch, and a hook that redirects `WebFetch` calls to it.
- `npm run smoke`: drives the built server over stdio (tool list, keyless catalogue, error paths; live fetches when `UNBLOCKINGAPI_KEY` is set).
- Setup guides: [docs/claude-setup.md](docs/claude-setup.md) and [docs/cursor-setup.md](docs/cursor-setup.md).

### Changed

- Tools are registered with `registerTool` and read-only annotations; MCP SDK `^1.30`, zod `^3.25`.
- Requests go out as `POST /unblock` with a JSON body (so `wait_rules` is a real array).

## 0.2.0

- `idealista_property` tool, new `block_assets` default, 70 s timeout.

## 0.1.0

- Initial release: `unblock_fetch`, `google_search`, `ahrefs_website_authority`.
