---
description: Sign in to UnblockingAPI and verify the connection works.
---

Walk the user through getting UnblockingAPI working. Be brief and concrete — they
may never have set up an MCP server before. Do not dump all the steps at once;
diagnose first, then give them only the step they actually need.

## 1. Find out where they stand

Call `unblock_fetch` with `url: "https://example.com"`. One of these happens:

- **It succeeds** → they are done. Tell them so, mention that each successful
  fetch costs 1 credit and failures are free, and show them one thing they can
  now ask for (see step 3).
- **The tool is missing, or it says sign-in is required** → go to step 2.
- **It says out of credits (HTTP 402)** → the setup is fine; they need to top up
  at https://unblockingapi.com/billing.

## 2. Sign in

The plugin connects to the hosted server at https://mcp.unblockingapi.com/mcp,
which signs in with their UnblockingAPI account. There is no key to copy.

Tell them to run `/mcp`, pick **unblockingapi** and choose **Authenticate**. A
browser opens on app.unblockingapi.com: they sign in (or sign up — new accounts
get 500 free credits with no card) and approve the connection.

Then run `unblock_fetch` on https://example.com again to confirm, and say plainly
whether it worked. If sign-in keeps failing, they can clear it from `/mcp` and
authenticate again.

## 3. Show them what it is for

Once it works, give them one or two concrete things to try, chosen for what they
seem to care about — not a feature list:

- Reading a page that needs JavaScript or refuses simple requests, with
  `unblock_fetch`.
- Structured JSON instead of HTML: call `find_templates` with a site they care
  about, and if a template covers it, fetch with `template:` set.
- A page from another country, with `location: "de"` or similar.

Mention that they can build a template for any site at
https://editor.unblockingapi.com.
