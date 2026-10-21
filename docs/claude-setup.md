# UnblockingAPI for Claude

Give Claude a real browser. Once connected, Claude reads bot-protected pages,
renders JavaScript when a page needs it, and pulls structured JSON from any site
a published template covers — all through your own UnblockingAPI key.

**Before you start:** sign up at <https://unblockingapi.com>. New accounts get
500 free credits, no card required.

Pick the path for how you use Claude:

| You use… | Do this | Time |
| --- | --- | --- |
| **Claude.ai** or **Claude Desktop** (chat) | [Add the connector](#claudeai-and-claude-desktop-connector) — recommended, no key to copy | 1 min |
| **Claude Code** (terminal, VS Code, desktop app) | [Install the plugin from the UI](#install-it-from-the-claude-code-ui) — recommended | 1 min |
| Claude Code, but you only want the tools | [`claude mcp add` with the hosted server](#claude-code-mcp-server-only) | 1 min |
| Claude Desktop, running the server locally | [Edit the config file](#claude-desktop-local-server) | 2 min |

---

## Claude.ai and Claude Desktop: connector

UnblockingAPI runs a hosted MCP server, so there is nothing to install and no
key to paste: you sign in with your UnblockingAPI account.

**1.** In Claude, open *Customize → Connectors*, click **+ Add** and choose
**Add custom connector**.

**2.** Name it `UnblockingAPI` and paste the URL:

```
https://mcp.unblockingapi.com/mcp
```

Keep the detected sign-in settings (*Register automatically* as the OAuth
client) and click **Add**.

**3.** Click **Connect**. An UnblockingAPI page opens: sign in, check that it asks
to connect Claude and will send you back to claude.ai, and click **Allow**.

**4.** In a chat, open **+ → Connectors** and switch UnblockingAPI on, then ask
Claude to read a page. To have Claude read every page this way, turn off its
built-in *Web search* in the same menu. Claude never sees your API key, and you can disconnect it any time under
*Settings → Connected apps* at app.unblockingapi.com.

Custom connectors work on every Claude plan (the free plan allows one). On Team
and Enterprise, an owner adds it under *Organization settings → Connectors* and
members then click *Connect*.

---

## Claude Code: plugin

The plugin is the full package: the hosted MCP server, signed in with your
UnblockingAPI account (no key to copy), a skill that teaches Claude the
fetch-then-render workflow and templates, and a `/unblockingapi:setup` command
that checks everything works.

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

**3. Sign in.** Run `/mcp`, pick **unblockingapi** and choose **Authenticate**.
A browser opens on app.unblockingapi.com: sign in (or sign up — 500 free
credits, no card) and approve. Or type `/unblockingapi:setup` and Claude walks
you through it and confirms when it works.

**4. Check it landed.** `/mcp` should show `unblockingapi` as connected with
three tools: `unblock_fetch`, `find_templates` and `get_build_guide`. Then try:

> Use unblockingapi to get the Google results for "wikipedia" as structured data.

Claude should call `find_templates`, find the Google search template, and come
back with parsed results rather than HTML.

### Install it from the terminal

```bash
claude plugin marketplace add unblockingapi/mcp
```

```bash
claude plugin install unblockingapi@unblockingapi-plugins
```

Then sign in from `/mcp` in a session, as in step 3.

**Updating:** third-party marketplaces do not auto-update, so pull new plugin
versions yourself with `claude plugin marketplace update unblockingapi-plugins`,
or turn on auto-update under `/plugin` → *Marketplaces*. The server is hosted,
so new tools arrive without reinstalling.

**Removing:** `claude plugin uninstall unblockingapi@unblockingapi-plugins`.

## Claude Code: MCP server only

If you'd rather not install a plugin, register the server directly. You get the
same three tools: `unblock_fetch`, `find_templates` and `get_build_guide`, without
the plugin's skill and setup command.

**Hosted (recommended)** — nothing to install, and you sign in instead of
pasting a key:

```bash
claude mcp add --transport http unblockingapi https://mcp.unblockingapi.com/mcp
```

Then run `/mcp`, pick `unblockingapi` and choose **Authenticate**: an
UnblockingAPI page opens, sign in and click **Allow**.

**Local, with `npx`** — runs the server on your machine with your API key
(needs Node.js 18+):

```bash
claude mcp add unblockingapi \
  -e UNBLOCKINGAPI_KEY=your_api_key_here \
  -- npx -y @unblockingapi/mcp
```

Either way, add `--scope project` to share it with your team via `.mcp.json`,
or leave it at the default user scope so it follows you into every project.

Verify with `claude mcp list` — `unblockingapi` should read **Connected**.

To make Claude use it for every page, add a line to your `CLAUDE.md`:

```markdown
When you need the contents of a URL, use the unblockingapi `unblock_fetch` tool
instead of WebFetch. Leave render unset; the API picks plain fetch or browser itself.
```

---

## Claude Desktop: local server

The [connector](#claudeai-and-claude-desktop-connector) is simpler. To run the
server on your own machine instead, Claude Desktop reads MCP servers from a
config file and needs a restart after you edit it.

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
list `unblock_fetch`, `find_templates` and `get_build_guide`.

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
| The connector's sign-in page says the connection can't continue | Remove the connector and add it again; Claude registers itself afresh. |
| The plugin's tools are missing or say sign-in is required | Run `/mcp`, pick **unblockingapi** and choose **Authenticate**. |
| "No UnblockingAPI key is configured" | A local (`npx`) install without a key: check the `env` block / `-e` flag. |
| "Invalid or missing API key (HTTP 401)" | The key is wrong or was revoked. Copy it again from the dashboard. |
| "Out of credits (HTTP 402)" | Top up at <https://unblockingapi.com/billing>. |
| "Too many requests in flight (HTTP 429)" | You hit your plan's concurrency cap. Claude will retry once another request finishes. |
| Tools don't appear in Claude Desktop | The config file is not valid JSON, or the app was not restarted. |
| Not sure what is wrong | Run `/unblockingapi:setup` — it diagnoses sign-in, the connection and your credits, and tells you the one thing to fix. |
| A rendered fetch times out | Lower `settle_ms`, or wait on a specific selector with `wait_for`. A render's hard ceiling is 140 s (about 170 s when a blocked plain fetch falls back to one). |
