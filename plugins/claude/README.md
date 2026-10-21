# UnblockingAPI for Claude Code

Read web pages that need JavaScript or refuse simple requests, and get clean
Markdown, HTML or template JSON back. The plugin connects Claude Code to the
hosted UnblockingAPI server at `https://mcp.unblockingapi.com/mcp` and signs in
with your UnblockingAPI account, so there is no API key to copy.

## Install

```
/plugin marketplace add unblockingapi/mcp
/plugin install unblockingapi@unblockingapi-plugins
```

Then run `/mcp`, pick **unblockingapi** and choose **Authenticate**. A browser
opens on app.unblockingapi.com: sign in (new accounts get 500 free credits, no
card) and approve. Or run `/unblockingapi:setup` and Claude walks you through it.

## What you get

- **Tools:** `unblock_fetch` (read a page; the API picks a plain fetch or a real
  browser per site), `find_templates` (templates that turn a site into JSON) and
  `get_build_guide` (guides for building apps on the API). All are read-only.
- **Skills:** `unblock` for reading pages, and `build-app`, `templates` and
  `app-recipes` for writing code on the REST API (a rank tracker, price monitor
  or listings aggregator, for example).
- **Command:** `/unblockingapi:setup` checks sign-in, the connection and your
  credits.

Every successful fetch costs 1 credit; failures are free.

## Links

- Setup guide and troubleshooting: <https://github.com/unblockingapi/mcp/blob/main/docs/claude-setup.md>
- Support: <https://unblockingapi.com/contact>
- Privacy policy: <https://unblockingapi.com/privacy>
- Terms: <https://unblockingapi.com/terms>
