---
name: build-app
description: Use when writing code that calls UnblockingAPI, or code that must fetch or scrape web pages from an app, script, backend, scheduled job or integration and UnblockingAPI is the chosen fetcher. Covers the REST API (POST /unblock), keeping the key server-side, timeouts and background jobs, concurrency, retries, credits and getting complete pages.
---

# Building on UnblockingAPI

Apps call the REST API directly over HTTPS with the language's own HTTP client
(`fetch`, `urllib`/`httpx`, `Net::HTTP`, curl). Do not add an SDK dependency, and
do not route app code through the MCP tools: those are for reading pages in this
conversation, not for code that runs later.

Read `references/api.md` before writing the client code. It has the request and
response fields, the status codes and drop-in client functions for JavaScript
and Python. Read `references/fetch-tuning.md` when a page comes back incomplete.

## Rules that decide whether the app works

1. **The key stays on the server.** Read it from an environment variable or the
   platform's secret store (`UNBLOCKINGAPI_KEY`) and call the API only from
   server code: a route handler, server action, edge function, worker or cron
   job. Never put it in browser JavaScript, a mobile bundle or a committed file.
   If the project is client-only, add a small server function for the call.
2. **Allow 180 seconds.** A plain fetch takes seconds; a rendered one usually
   5-20 s and up to ~170 s when a blocked plain fetch falls back to a browser.
   Set the HTTP client timeout to 180 s, and do not fetch inside a web request
   that a platform kills after 10-30 s: fetch in a background job, queue or
   scheduled function, store the result and serve it from the database.
3. **Small worker pool, honest retries.** Process lists 3-5 at a time. Retry
   429 (plan concurrency) and 503/504 with backoff. A 500 means the target
   blocked or failed: it is free, retry later rather than in a tight loop. Stop
   the job on 402 (out of credits) and fix the request on 422.
4. **Leave `render` unset.** The API fetches plainly first and switches to a
   browser per site when it must. Set `render: true` only for content that
   JavaScript fills in after load, and use the wait options from
   `references/fetch-tuning.md` only when content is actually missing.
5. **Look for a template before writing a parser.** A template returns JSON
   instead of HTML and can be fixed without redeploying the app. Use the
   `templates` skill (or `find_templates` with the target URL) first; parse the
   HTML yourself only when none covers the site.
6. **Credits.** Every successful fetch costs 1 credit, failures are free.
   Estimate the monthly cost for the user (items x checks per day x 30), cache
   what was fetched instead of re-fetching, and schedule refreshes no more often
   than the data changes.

## Checking `status`

`status: "succeeded"` (HTTP 200, or 404 when the target itself said 404) means
`response` holds the page. `http_response_code` is the target's own status, so a
404 page is a successful fetch of a missing page. Anything else carries `error`.

## Before you finish

- The key is read from the environment, and a missing key gives a clear error.
- The timeout is 180 s and fetching happens outside short web requests.
- 429/503/504 are retried with backoff, 402 stops the run.
- Templates are pinned (`handle/name@n`) and `parse_error: true` is handled.
- Tell the user where to put the key (their dashboard at unblockingapi.com has
  it; new accounts get 500 free credits) and what the job will cost per month.

For a rank tracker, price monitor or listings aggregator, the `app-recipes`
skill has a complete design.
