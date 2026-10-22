---
name: unblock
description: Use whenever you need to read a web page, URL, article, documentation page, search result, product page or any live website content. Fetches through UnblockingAPI (unblock_fetch, find_templates), letting the API pick a plain fetch or a real browser per site, and returning structured JSON when a template covers the site.
---

# Reading the web with UnblockingAPI

You have the UnblockingAPI MCP server. Use it to read web pages: it goes out
through residential proxies and a real browser when needed, so it can read
public pages that need JavaScript, refuse simple requests or depend on location.

## Workflow

1. **Leave `render` unset.** `unblock_fetch(url)` lets the API decide: a fast plain
   fetch first, and a real browser instead when that comes back blocked, as a
   challenge wall or as an empty JavaScript shell. It learns per site, so the next
   request goes straight to the browser. `render_reason` in the output says what
   happened. Clean HTML comes back with scripts, styles, SVGs and cookie banners
   stripped.
2. **Force a mode only when you know better.** `render: true` when the page
   loaded but content you need is filled in by JavaScript; `render: false` never
   renders. A render can take up to two minutes on slow sites.
3. **Tune the wait only if a render is still missing content.** `wait_for` takes a
   CSS selector or `stable` / `domcontentloaded` / `networkidle`; `wait_state`
   refines a selector wait (`nonempty`, `hidden` for a spinner, `stable`);
   `scroll_steps` triggers lazy sections; `wait_min_ms` adds a minimum delay;
   `settle_ms` caps how long the page may keep changing; `wait_rules` handles
   pages with several layouts (consent gate, interstitial). Any of these implies a
   browser. `readiness.verification.status: "interactive"` means a verification
   (Turnstile, reCAPTCHA, DataDome, …; `vendor` says which) wants a human, and
   waiting longer will not help.
4. **Geo-restricted or localised pages:** pass `location` as a 2-letter country
   code (`us`, `gb`, `de`, `se`, …).
5. **Re-reading a page:** the exact same fetch (another `select` or `format`)
   within 10 minutes is reused for free; pass `fresh: true` to fetch again.
   `max_age` (seconds, up to 300) accepts the API's cached copy instantly but
   still costs 1 credit, and changes the fetch, so it misses that free reuse.

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

`find_templates` also takes `search` (free text) and `category`, and is free —
it charges no credit, so checking costs you nothing but a moment.

If a template's parser fails because the site changed, you get the raw HTML back
with `parse_error: true` in the metadata rather than an error. Parse it yourself
in that case.

## Getting the part you need

- The body is **Markdown** by default. Use `format: "html"` when you need markup
  or attributes, and `select` (a CSS selector) to keep only the part you need,
  e.g. the items of a list. Re-reading the same fetch with another `select` or
  `format` reuses the page: no new request, no credit.
- **Feeds and lists that load more as you scroll** (reddit, social feeds,
  infinite-scroll shops) come back with their first screen only. Fetch again
  with `scroll_steps: 3`-`5`. The response's notes say when this applies.
- **Content that appears late**: `wait_for: "<selector>"` with `wait_state: "nonempty"`.

## Building an app on UnblockingAPI

Writing code that calls UnblockingAPI (a rank tracker, an aggregator, a
monitor, any script or backend) is a different job from reading pages here: use
the `build-app` skill, with `templates` and `app-recipes` as needed. Apps call
the REST API directly with plain HTTP from server code.

## Reading the result

The tool output starts with a JSON metadata block (`status`, `http_response_code`,
`render`, `render_reason`, `readiness`, `cached`, `truncated`, …) followed by `---` and the body. A `truncated`
flag means the page was longer than `max_chars`; ask for more with a larger
`max_chars` only if the part you need was cut off.

## Costs

Every successful fetch costs 1 credit; failures are free. Do not loop on retries:
if a URL fails twice, report the error instead.
