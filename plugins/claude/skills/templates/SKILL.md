---
name: templates
description: Use when code needs structured data (JSON fields) from a website through UnblockingAPI, for example search results, listings, products, prices or company records, or when the user asks about UnblockingAPI templates. Covers finding a published template for a URL, its output shape, calling it from an app, pinning versions, handling parse errors and building a new template in the editor.
---

# UnblockingAPI templates in an app

A template parses one kind of page into named fields. Passing its reference as
`template` makes `/unblock` return `response_format: "json"` with `response` as
an object, so the app stores fields instead of parsing HTML.

Read `references/templates.md` for the endpoints, an output example and the
calling code.

## Workflow

1. **Find one for the exact URL the app will fetch.** In this conversation call
   `find_templates` with that URL; it searches every published template and
   returns the fields each produces. Without the tool, read
   `GET https://api.unblockingapi.com/templates.json?url=<url>` (no key).
2. **Get the real output shape** before writing types or a schema:
   `GET https://app.unblockingapi.com/public/v1/templates/<handle>/<name>`
   returns `response_skeleton` and `field_tree`. Write the app's types from that,
   not from a guess.
3. **Call it with a pinned version** in production: `template: "handle/name@3"`.
   `template_version` in the response says which version answered. A template
   forces its own render and wait settings, so do not add wait options to it.
4. **Handle `parse_error: true`.** When the site changed and the template's
   parser failed, the response is HTML instead of JSON. Log it, keep the last
   good data, and do not write the HTML into JSON columns.
5. **No template for the site?** Either parse the HTML in code (cheerio or
   linkedom in JavaScript, BeautifulSoup or selectolax in Python, selecting the
   repeated item element), or suggest the user builds one without code at
   https://editor.unblockingapi.com: load the page, click the fields, publish.
   A template can be repaired in the editor when the site changes, without
   redeploying the app, which is usually the better choice for a site the app
   depends on.

Templates are listed in the template library at https://unblockingapi.com/templates.
