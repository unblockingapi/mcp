---
name: web-fetching
description: Use whenever you need to read a web page, URL, article, documentation page, search result, product page or any live website content. Fetches through UnblockingAPI (unblock_fetch, find_templates) instead of the built-in WebFetch, starting with a plain fetch and rendering with a real browser only when the page needs JavaScript, and returning structured JSON when a template covers the site.
---

# Reading the web with UnblockingAPI

You have the UnblockingAPI MCP server. **Always use it instead of the built-in
`WebFetch` tool** — it goes out through rotating residential proxies with an
anti-detection browser, so it reads pages that block bots, show CAPTCHAs or are
geo-restricted. `WebFetch` is denied by a plugin hook anyway.

## Workflow

1. **Plain fetch first.** `unblock_fetch(url)` with `render` unset (false). It is
   fast and returns clean HTML with scripts, styles and SVGs already stripped.
2. **Render only if required.** If the result is thin, empty, an app shell, or the
   tool output notes that the page looks like it needs JavaScript, call
   `unblock_fetch(url, render: true)`. Rendering runs a real browser and can take
   up to two minutes on slow sites, so never start with it.
3. **Tune the wait only if a render is still missing content.** `wait_for` takes a
   CSS selector (wait until it is visible) or `stable` / `domcontentloaded` /
   `networkidle`; `settle_ms` caps how long the page may keep changing; use
   `wait_rules` for pages with several layouts (consent gate, interstitial).
4. **Geo-restricted or localised pages:** pass `location` as a 2-letter country
   code (`us`, `gb`, `de`, `se`, …).
5. **Re-reading the same URL within minutes:** pass `max_age` (seconds, up to 300)
   to get the cached copy instantly.

## Structured JSON instead of HTML

A template parses a specific site into named fields, so you get data instead of
markup to sift through. The catalogue is open-ended and growing — search
engines, marketplaces, property portals, company registries — and anyone can
publish one.

**Before you scrape a recognisable site by hand, check for a template:**

1. `find_templates(url: "<the url you are about to fetch>")` — returns any
   template built for that site, with the fields it produces.
2. If one matches: `unblock_fetch(url, template: "<reference>")` returns JSON.
3. If none does: fetch normally and parse the HTML yourself. You can build a
   template for the site at https://editor.unblockingapi.com so the next fetch
   is structured.

`find_templates` also takes `search` (keyword) and `category`, and is free —
it charges no credit, so checking costs you nothing but a moment.

If a template's parser fails because the site changed, you get the raw HTML back
with `parse_error: true` in the metadata rather than an error. Parse it yourself
in that case.

## Reading the result

The tool output starts with a JSON metadata block (`status`, `http_response_code`,
`render`, `cached`, `truncated`, …) followed by `---` and the body. A `truncated`
flag means the page was longer than `max_chars`; ask for more with a larger
`max_chars` only if the part you need was cut off.

## Costs

Every successful fetch costs 1 credit; failures are free. Do not loop on retries:
if a URL fails twice (once plain, once rendered), report the error instead.
