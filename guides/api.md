# Building on UnblockingAPI: the REST API

UnblockingAPI fetches any public web page through rotating residential proxies,
switching to a real browser when the site needs one, and can parse the page into
JSON with a template. Apps call it over plain HTTPS with the language's own HTTP
client (`fetch` in JavaScript/TypeScript, `urllib`/`httpx` in Python, …). No SDK
is needed.

## The request

`POST https://api.unblockingapi.com/unblock` with a JSON body (or `GET` with the
same names as query parameters).

| Header | Value |
| --- | --- |
| `X-Api-Key` | the account's API key (or `Authorization: Bearer <key>`) |
| `Content-Type` | `application/json` |

| Body field | What it does |
| --- | --- |
| `url` (required) | The page. http(s), not a media/binary file. |
| `template` | `handle/name` (optionally `@version`): return JSON parsed by that template instead of HTML. |
| `location` | 2-letter country to fetch from (`us`, `gb`, `de`, `se`, `es`, …). |
| `render` | Omit it: the API fetches plainly first and uses a browser when the page is blocked or empty (learned per site). `true` always renders, `false` never. |
| `wait_for`, `wait_state`, `settle_ms`, `scroll_steps` (0-10), `wait_min_ms`, `wait_rules`, `detect_ms` | Browser waits, for pages that load content late. See the `fetch-tuning` guide. Any of these implies a render. |
| `max_age` | Accept a cached copy of the same request up to N seconds old (0-300). |

```js
// Server-side only: the key must never reach a browser.
export async function unblock(url, options = {}) {
  const res = await fetch("https://api.unblockingapi.com/unblock", {
    method: "POST",
    headers: { "X-Api-Key": process.env.UNBLOCKINGAPI_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...options }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await res.json();
  if (body.status === "succeeded") return body;           // 200, or 404 from the target
  if (body.status === "failed") throw new Error(`${res.status}: ${body.error}`); // 500/503/504: the fetch failed
  throw new Error(`${res.status}: ${body.error}`);         // 401/402/422/429: the request was refused
}
```

```python
import json, os, urllib.request

def unblock(url, **options):
    req = urllib.request.Request(
        "https://api.unblockingapi.com/unblock",
        data=json.dumps({"url": url, **options}).encode(),
        headers={"X-Api-Key": os.environ["UNBLOCKINGAPI_KEY"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as res:   # raises HTTPError on 4xx/5xx; its body is JSON too
        return json.load(res)
```

## The response

```json
{
  "job_id": "…",
  "url": "https://…",
  "status": "succeeded",
  "http_response_code": 200,
  "render": true,
  "render_reason": "fallback:blocked",
  "location": "us",
  "response_format": "html",
  "response": "<html>…</html>",
  "readiness": { "status": "satisfied", "waited_ms": 1200, "scroll_steps": 0 }
}
```

- `response` is cleaned HTML (scripts, styles, SVGs and cookie banners stripped)
  when `response_format` is `"html"`, and the parsed object when it is `"json"`
  (a template). `api_name` / `template_version` say which template answered;
  `parse_error: true` means the template failed and HTML came back instead.
- `http_response_code` is the target's own status. A target 404 is a success.

## Status codes

| HTTP | Meaning | What to do |
| --- | --- | --- |
| 200 / 404 | Fetched (`status: "succeeded"`). | Use `response`. |
| 401 | Missing or wrong key. | Check the secret. |
| 402 | Out of credits. | Top up at unblockingapi.com/billing; stop the job. |
| 422 | Invalid parameters (`error` says which). | Fix the request. |
| 429 | Too many requests in flight for this key (plan concurrency). | Limit parallelism; retry after one finishes. |
| 500 | The target blocked or failed (`http_response_code` has its status). | Retry later, maybe with `location`. Free. |
| 503 | Temporarily no capacity. | Retry after a few seconds. |
| 504 | Timed out. | Retry; lower waits. |

Failures cost nothing; every success costs 1 credit (cache hits too).

## Timeouts and concurrency

- A plain fetch takes seconds. A rendered one usually 5-20 s, worst case about
  140 s, and a plain fetch that falls back to a browser up to ~170 s. Set your
  HTTP timeout to 180 s, and don't call the API inside a request handler that a
  platform kills after 10-30 s: run it in a background job, queue or cron, and
  store the results.
- Concurrency is per plan (Pay as you Go 5, Scout 10, Builder 25, Growth 50
  requests in flight). Process lists with a small worker pool (3-5) and retry
  429 and 503 with backoff.

## Keeping the key server-side

The API key is a secret: put it in an environment variable or the platform's
secret store and call the API only from server code.

- **Lovable**: a Supabase Edge Function, with the key in Supabase secrets.
- **Replit**: Replit Secrets (`process.env.UNBLOCKINGAPI_KEY`), called from the
  backend.
- **Bolt / Next.js / Vercel**: a route handler or server action, key in env vars.
- **Cron / workers**: Supabase scheduled functions, Vercel Cron, Replit Scheduled
  Deployments, GitHub Actions, or a plain cron job.

Never put the key in client-side JavaScript, a mobile app bundle or a public
repo.

## Templates

`GET https://api.unblockingapi.com/templates.json?limit=200` (no key) lists
published templates with the `host`/`path` each covers and its `fields`. Pass a
template's `reference` as `template` to get JSON. See the `templates` guide for
output shapes and building your own.

## Be a good citizen

Fetch public pages, respect the sites' terms, cache what you fetched (`max_age`,
or your own database) instead of re-fetching, and schedule refreshes no more
often than the data changes. Use within UnblockingAPI's Acceptable Use Policy.
