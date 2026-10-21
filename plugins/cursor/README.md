# UnblockingAPI for Cursor

Fetch public web pages that block simple requests, and get clean Markdown, HTML
or template JSON back.

This plugin adds UnblockingAPI's hosted MCP server to Cursor, plus an optional
rule that tells the agent when to use it. You need an UnblockingAPI account:
sign up at <https://unblockingapi.com> (500 free credits, no card).

## What you get

| Tool | What it does | Cost |
| --- | --- | --- |
| `unblock_fetch` | Fetch a URL and get Markdown (default) or HTML (`format: "html"`), optionally narrowed with a CSS `select`. Pass `template` to get structured JSON. | 1 credit per successful fetch; failures are free |
| `find_templates` | Find a template that turns a site into JSON, by URL, keyword or category. | free |
| `get_build_guide` | Guides for building apps on the UnblockingAPI REST API. | free |

All three tools are read-only.

The rule `rules/unblockingapi.mdc` is not always applied: the agent picks it up
when it needs a page its own web tool can't read, or structured data from a
site a template covers.

## Setup

### Hosted server (this plugin)

The plugin connects to `https://mcp.unblockingapi.com/mcp` (Streamable HTTP).
After installing it, open *Cursor Settings → MCP*, click **Login** next to
`unblockingapi`, sign in on the UnblockingAPI page that opens and click
*Allow*. Cursor never sees your API key, and you can disconnect it any time
under *Settings → Connected apps* at app.unblockingapi.com.

### With an API key instead of signing in

Add the server to `~/.cursor/mcp.json` yourself and send your key as a header:

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

### Local server (manual option)

The same server runs locally over stdio with `npx` (Node.js 18+):

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

## Try it

> Use unblockingapi to get the Google results for "wikipedia" as structured data.

The agent should call `find_templates`, find the Google search template, and
return parsed results.

## Links

- Docs: <https://unblockingapi.com/tools/cursor>
- Privacy: <https://unblockingapi.com/privacy>
- Support: <hello@unblockingapi.com>
- Source: <https://github.com/unblockingapi/mcp>
