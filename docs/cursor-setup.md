# UnblockingAPI for Cursor

Give Cursor's agent a real browser. Once connected it reads live documentation,
changelogs and pages that block automated tools, renders JavaScript when a page
needs it, and returns structured JSON for any site a published template covers —
all through your own UnblockingAPI key.

**Before you start:** sign up at <https://unblockingapi.com>. New accounts get
500 free credits, no card required.

---

## 1. Add the server

### Option A — hosted server, one click (recommended)

Nothing to install and no key to paste: Cursor connects to UnblockingAPI's
hosted MCP server and you sign in with your account.

[**Add UnblockingAPI (hosted) to Cursor**](cursor://anysphere.cursor-deeplink/mcp/install?name=unblockingapi&config=eyJ1cmwiOiJodHRwczovL21jcC51bmJsb2NraW5nYXBpLmNvbS9tY3AifQ==)

Or put this in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "unblockingapi": { "url": "https://mcp.unblockingapi.com/mcp" }
  }
}
```

Under *Settings → MCP*, click **Login** next to `unblockingapi`, allow access on
the UnblockingAPI page that opens, and the server turns green. To use a key
instead of signing in, add `"headers": { "Authorization": "Bearer your_api_key_here" }`
next to the `url`.

### Option B — local server, one click

Copy your API key from the dashboard, then open this link with Cursor
installed; it opens the *Install MCP server* dialog with everything prefilled:

[**Add UnblockingAPI to Cursor**](cursor://anysphere.cursor-deeplink/mcp/install?name=unblockingapi&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB1bmJsb2NraW5nYXBpL21jcCJdLCJlbnYiOnsiVU5CTE9DS0lOR0FQSV9LRVkiOiJ5b3VyX2FwaV9rZXlfaGVyZSJ9fQ==)

After installing, open *Cursor Settings → MCP*, click the `unblockingapi`
entry and replace `your_api_key_here` with your real key.

### Option C — local server in `mcp.json`

For every project, put this in `~/.cursor/mcp.json`; for one project, in
`.cursor/mcp.json` at the repo root. Merge into an existing `mcpServers` block
if you already have one.

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

Cursor picks the file up immediately. Under *Settings → MCP* the server should
show a green dot and two tools: `unblock_fetch` and `find_templates`.

### Option D — ask the agent

Cursor's agent can edit its own config. Paste this into a chat:

> Install the `@unblockingapi/mcp` MCP server in my global Cursor MCP config.
> My API key is `sk_xxx`. It runs over stdio via `npx -y @unblockingapi/mcp`
> and needs the env var `UNBLOCKINGAPI_KEY`.

---

## 2. Make the agent prefer it

Cursor has its own web tool. To make the agent reach for UnblockingAPI whenever
it needs a page, add a rule. Create `.cursor/rules/unblockingapi.mdc` in your
project (or add the same text under *Settings → Rules → User Rules* for all
projects):

```markdown
---
description: Read web pages through UnblockingAPI
alwaysApply: true
---

When you need the contents of a URL, use the `unblock_fetch` tool from the
unblockingapi MCP server instead of the built-in web tool. Leave render unset:
the API fetches plainly first and switches to a real browser when the site needs
one. Before parsing a recognisable site by hand, call
`find_templates` with the URL — if a template covers it, pass its reference as
`unblock_fetch`'s template argument and you get structured JSON instead of HTML.
```

---

## 3. Try it

Paste into the agent:

> Use unblockingapi to get the Google results for "wikipedia" as structured data.

The agent should call `find_templates`, find the Google search template, and
come back with parsed results rather than HTML.

---

## Using it

Ask naturally — the agent picks the tool:

- *"Read the latest release notes at https://… and tell me if anything breaks our usage."*
- *"Fetch this page from a US IP: https://…"* → `location: "us"`
- *"Is there a template for this site?"* → `find_templates(url)`
- *"Pull this listing as structured data"* → `find_templates`, then `unblock_fetch` with `template:`

Each successful fetch costs 1 credit; failures are free. Rendered fetches cost
the same but take longer, which is why the agent tries plain first.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Red dot next to the hosted server | Click **Login** next to it under *Settings → MCP* and allow access. |
| Red dot next to the local server | `npx` could not start: install Node.js 18+ from <https://nodejs.org>, then toggle the server off and on. |
| "No UnblockingAPI key is configured" | The `env` block is missing or still says `your_api_key_here`. |
| "Invalid or missing API key (HTTP 401)" | The key is wrong or was revoked. Copy it again from the dashboard. |
| "Out of credits (HTTP 402)" | Top up at <https://unblockingapi.com/billing>. |
| "Too many requests in flight (HTTP 429)" | You hit your plan's concurrency cap. Retry once another request finishes. |
| The agent still uses its own web tool | Add the rule from step 2, or mention "use unblockingapi" in your prompt. |
