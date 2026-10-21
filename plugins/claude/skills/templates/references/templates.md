# Templates: JSON instead of HTML

A template parses one kind of page (a Google results page, a property search,
a company registry entry) into named fields. Call it by reference and the API
returns `response_format: "json"` with `response` as an object.

## Find one

- `GET https://api.unblockingapi.com/templates.json?limit=200` (no key): every
  published template with `reference`, `host`, `path`, `fields`, `sample_url`,
  `render`, `location`. Match by host and path.
- The output shape: `GET https://app.unblockingapi.com/public/v1/templates/<handle>/<name>`
  returns `response_skeleton` (example JSON with types) and `field_tree`.
- In an MCP session, `find_templates(url)` does both.

Example: `kjellberg/google-search` (for `google.com/search?q=…`) returns

```json
{
  "query": "string",
  "results": [{ "position": 1, "title": "string", "description": "string", "url": "string" }],
  "related_searches": [{ "query": "string", "url": "string" }]
}
```

## Call it

```js
const page = await unblock("https://www.google.com/search?q=espresso+machine&hl=en&gl=us", {
  template: "kjellberg/google-search",
  location: "us",
});
const results = page.response.results; // [{ position, title, description, url }, …]
```

Pin a version with `@n` (`kjellberg/google-search@3`) in production so a template
update cannot change your data shape unexpectedly; `template_version` in the
response says which version answered. A template forces its own render and wait
settings.

## No template for the site?

1. Fetch the HTML and parse it in your code (cheerio / linkedom in JS,
   BeautifulSoup / selectolax in Python), selecting the repeated item element.
2. Or build a template without code in the visual editor at
   https://editor.unblockingapi.com: load the page, click the fields, publish.
   The app then calls it by name and gets JSON, and the template can be fixed
   in the editor when the site changes, without redeploying the app.

If a template's parser fails because the site changed, the response has
`parse_error: true` and HTML instead of JSON: handle that case.
