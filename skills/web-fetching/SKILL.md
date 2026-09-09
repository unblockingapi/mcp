---
name: web-fetching
description: Use whenever you need to read a web page, URL, article, documentation page, search result, product page or any live website content. Fetches through UnblockingAPI (unblock_fetch / google_search / list_templates) instead of the built-in WebFetch, starting with a plain fetch and rendering with a real browser only when the page needs JavaScript.
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

## Search and structured data

- **Google results:** `google_search(q, location?, language?, start?)` returns JSON
  (`results[{position,title,description,url}]`, `related_searches`). Use it rather
  than fetching a Google URL by hand.
- **Sites with a template:** `list_templates(search?)` shows published parsers
  (property portals, business directories, search engines, …) with an example
  call each. `unblock_fetch(url, template: "<reference>")` then returns JSON
  instead of HTML.

## Reading the result

The tool output starts with a JSON metadata block (`status`, `http_response_code`,
`render`, `cached`, `truncated`, …) followed by `---` and the body. A `truncated`
flag means the page was longer than `max_chars`; ask for more with a larger
`max_chars` only if the part you need was cut off.

## Costs

Every successful fetch costs 1 credit; failures are free. Do not loop on retries:
if a URL fails twice (once plain, once rendered), report the error instead.
