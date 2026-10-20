# Recipe: Google rank tracker

Track where domains rank on Google for a list of keywords, per country, over time.

## Data model

- `projects`: name, domain(s) to track (e.g. `example.com`), country (`us`), language (`en`).
- `keywords`: project_id, keyword.
- `rankings`: keyword_id, checked_at, position (null if not in the results),
  url (the ranking page), title, plus the top results as JSON for context.

## Fetching

One request per keyword per country per check, using the Google template:

```js
const q = new URLSearchParams({ q: keyword, hl: language, gl: country });
const page = await unblock(`https://www.google.com/search?${q}`, {
  template: "kjellberg/google-search",
  location: country,          // search from that country
});
const results = page.response.results;  // [{ position, title, description, url }]
const hit = results.find((r) => { const h = hostOf(r.url); return h === domain || h.endsWith("." + domain); });  // exact host or a real subdomain, never notexample.com
await saveRanking({ keywordId, position: hit?.position ?? null, url: hit?.url, title: hit?.title, top: results.slice(0, 10) });

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
```

- `location` and `gl` should match: results differ by country.
- Google returns about 10 organic results per page; for deeper tracking fetch
  page 2 with `start=10`. Not found = "not in the top N" (store null).
- Pin the template version in production (`kjellberg/google-search@<n>`).

## Scheduling

- Run checks in a scheduled background job (daily is typical), not in a web
  request: a rendered fetch can take tens of seconds.
- Use a worker pool of 3-5 concurrent requests and retry 429/503/504 with
  backoff; a 500 for one keyword is free, so retry it next run.
- Store every check; draw position over time per keyword, and the movement
  since the last check (up/down/new/lost).

## Cost

1 credit per keyword per country per check. 100 keywords x 1 country x daily
= ~3,000 credits/month.

## UI

Projects list; per project a table of keywords with current position, change
since last check and a sparkline; a keyword detail view with the history chart
and the top 10 from the latest check; a form to add keywords in bulk.
