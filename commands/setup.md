---
description: Set up or check your UnblockingAPI key, and verify the connection works.
---

Walk the user through getting UnblockingAPI working. Be brief and concrete — they
may never have set up an MCP server before. Do not dump all the steps at once;
diagnose first, then give them only the step they actually need.

## 1. Find out where they stand

Call `find_templates` (it is free and needs no key). If it errors, the MCP server
itself is not connected — tell them to check `/mcp` and stop here.

Then call `unblock_fetch` with `url: "https://example.com"`. One of three things
happens:

- **It succeeds** → they are done. Tell them so, mention that each successful
  fetch costs 1 credit and failures are free, and show them one thing they can
  now ask for (see step 4).
- **It says no key is configured** → go to step 2.
- **It says the key is invalid (HTTP 401)** → the stored key is wrong or was
  revoked. Send them to https://unblockingapi.com to copy it again, then step 2.
- **It says out of credits (HTTP 402)** → the setup is fine; they need to top up
  at https://unblockingapi.com/billing.

## 2. Get a key

If they do not have one: sign up at https://unblockingapi.com. New accounts get
500 free credits with no card, which is plenty to try this out. The key is on the
dashboard.

## 3. Store the key

Tell them to run this and paste the key into the **UnblockingAPI key** field:

```
/plugin configure unblockingapi@unblockingapi-plugins
```

Two things they need to know, because both bite people:

- The key is read when the MCP server starts, so after saving it they must
  reconnect the server from `/mcp`, or start a new session, before it works.
- If that screen is unavailable, they can instead export `UNBLOCKINGAPI_KEY` in
  the shell that launches Claude and restart from there.

Then run `unblock_fetch` on https://example.com again to confirm, and say plainly
whether it worked.

## 4. Show them what it is for

Once it works, give them one or two concrete things to try, chosen for what they
seem to care about — not a feature list:

- Reading a page that normally blocks bots, with `unblock_fetch`.
- Structured JSON instead of HTML: call `find_templates` with a site they care
  about, and if a template covers it, fetch with `template:` set.
- A page from another country, with `location: "de"` or similar.

Mention that they can build a template for any site at
https://editor.unblockingapi.com, and that from now on you will use
`unblock_fetch` instead of the built-in web fetch.
