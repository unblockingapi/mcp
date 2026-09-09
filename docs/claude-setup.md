# UnblockingAPI for Claude

Give Claude a real browser. Once connected, Claude reads bot-protected pages,
renders JavaScript when a page needs it, and pulls structured JSON from any site
a published template covers — all through your own UnblockingAPI key.

**Before you start:** sign up at <https://unblockingapi.com> and copy your API key
from the dashboard. New accounts get 500 free credits, no card required.

Pick the path for how you use Claude:

| You use… | Do this | Time |
| --- | --- | --- |
| **Claude Code** (terminal, VS Code, desktop app) | [Install the plugin from the UI](#install-it-from-the-claude-code-ui) — recommended | 1 min |
| Claude Code, but you only want the tools | [`claude mcp add`](#claude-code-mcp-server-only) | 1 min |
| **Claude Desktop** (chat app) | [Edit the config file](#claude-desktop) | 2 min |

---

## Claude Code: plugin

The plugin is the full package: the MCP server, your key stored securely, a
skill that teaches Claude the fetch-then-render workflow, and a hook that
redirects Claude's built-in `WebFetch` to `unblock_fetch`. From then on, every
page Claude reads goes through UnblockingAPI.

### Install it from the Claude Code UI

**1. Add the marketplace.** Type this in any Claude Code session:

```
/plugin marketplace add unblockingapi/mcp
```

**2. Install the plugin.** Open the plugin browser with `/plugin`, pick
*unblockingapi* under the **unblockingapi-plugins** marketplace and install it.
Typing the install directly does the same thing:

```
/plugin install unblockingapi@unblockingapi-plugins
```

**3. Add your key.** Claude Code asks for a plugin's settings when the plugin is
*enabled*, so you may see an *UnblockingAPI key* prompt right after installing —
fill it in and you are done. If you don't see one, or you dismissed it, the
install still succeeded with no key and only printed a one-line warning. Set it
explicitly with:

```
/plugin configure unblockingapi@unblockingapi-plugins
```

and paste your key into *UnblockingAPI key*. It is stored securely, never in a
file in your repo.

**4. Check it landed.** Run `/mcp` — `unblockingapi` should show as connected
with two tools. Then try:

> Use unblockingapi to fetch https://www.allabolag.se/foretag/ikea-of-sweden-ab/älmhult/industridesigners/2JYQ49RI5YFC1 as structured data.

Claude should call `find_templates`, find the allabolag template, and come back
with parsed company fields rather than HTML. If instead you get "No
UnblockingAPI key is configured", step 3 did not take — run it again.

### Install it from the terminal

Same thing in one shot, with the key inline:

```bash
claude plugin marketplace add unblockingapi/mcp
```

```bash
claude plugin install unblockingapi@unblockingapi-plugins --config api_key=your_api_key_here
```

`--config` only applies on a **fresh** install. If the plugin is already
installed, the command reports "already installed" and silently leaves the key
unset — use `/plugin configure` instead, or uninstall first:

```bash
claude plugin uninstall unblockingapi@unblockingapi-plugins
```

**Updating:** third-party marketplaces do not auto-update, so pull new plugin
versions yourself with `claude plugin marketplace update unblockingapi-plugins`,
or turn on auto-update under `/plugin` → *Marketplaces*. The MCP server itself is
fetched with `npx …@latest`, so new tools arrive without reinstalling.

**Removing:** `claude plugin uninstall unblockingapi@unblockingapi-plugins`.

### What the plugin changes

- Claude prefers `unblock_fetch` for any URL and starts with a plain fetch
  (`render: false`). It only renders with a real browser when the page comes back
  thin or says JavaScript is required — the tool output tells it so.
- The built-in `WebFetch` tool is denied with a message pointing at
  `unblock_fetch`. If you ever remove your key, the hook stands down and
  `WebFetch` works again, so a broken setup never leaves Claude blind.
- Nothing else changes: no permissions are pre-approved, no other tools are touched.

---

## Claude Code: MCP server only

If you'd rather not install a plugin, register the server directly. You get the
same two tools; Claude will usually pick `unblock_fetch` on its own because the
server describes it well, but `WebFetch` stays available.

```bash
claude mcp add unblockingapi \
  -e UNBLOCKINGAPI_KEY=your_api_key_here \
  -- npx -y @unblockingapi/mcp
```

Add `--scope project` to share it with your team via `.mcp.json`, or leave it at
the default user scope so it follows you into every project.

Verify with `claude mcp list` — `unblockingapi` should read **Connected**.

To make Claude use it for every page, add a line to your `CLAUDE.md`:

```markdown
When you need the contents of a URL, use the unblockingapi `unblock_fetch` tool
instead of WebFetch. Try render=false first, then render=true if the page needs JavaScript.
```

---

## Claude Desktop

Claude Desktop reads MCP servers from a config file and needs a restart after
you edit it.

**1. Open the config file:**

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

(Or *Settings → Developer → Edit Config* inside the app.)

**2. Add the server** — merge into any existing `mcpServers` block:

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

**3. Quit and reopen Claude Desktop.** The tools icon in the chat box should
list `unblock_fetch` and `find_templates`.

Claude Desktop needs Node.js 18+ on your PATH for `npx`. If the server fails to
start, install Node from <https://nodejs.org> and restart the app.

---

## Using it

You don't have to name the tools. Ask naturally:

- *"Read https://example.com/changelog and tell me what changed in the last release."*
- *"Fetch this page from a German IP: https://…"* → `location: "de"`
- *"Is there a template for this site?"* → `find_templates(url)`
- *"Pull this listing as structured data"* → `find_templates`, then `unblock_fetch` with `template:`

Each successful fetch costs 1 credit; failures are free. Rendered fetches cost
the same as plain ones but take longer, which is why Claude tries plain first.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "No UnblockingAPI key is configured" | The plugin was installed without a key. Run `/plugin configure unblockingapi@unblockingapi-plugins`. Manual installs: check the `env` block / `-e` flag. |
| `/plugin configure` says the plugin is unknown | The marketplace name is part of the id — use the full `unblockingapi@unblockingapi-plugins`. |
| `--config` had no effect | It only applies on a fresh install. Uninstall first, or use `/plugin configure`. |
| "Invalid or missing API key (HTTP 401)" | The key is wrong or was revoked. Copy it again from the dashboard. |
| "Out of credits (HTTP 402)" | Top up at <https://unblockingapi.com/billing>. |
| "Too many requests in flight (HTTP 429)" | You hit your plan's concurrency cap. Claude will retry once another request finishes. |
| Tools don't appear in Claude Desktop | The config file is not valid JSON, or the app was not restarted. |
| A rendered fetch times out | Lower `settle_ms`, or wait on a specific selector with `wait_for`. The hard ceiling is 140 s. |
