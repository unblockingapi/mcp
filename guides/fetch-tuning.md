# Getting complete pages

By default UnblockingAPI picks plain fetch or browser per site and captures a
rendered page once the DOM stops changing (`wait_for: "stable"`). Most pages
need nothing more. When content you need is missing, change the fetch:

| Symptom | Add |
| --- | --- |
| A list or feed has only the first items (more load as you scroll: reddit, social feeds, infinite-scroll shops) | `scroll_steps: 3` (up to 10). More steps = more items, slower. |
| Content appears after load or behind a spinner | `wait_for: "<css selector of that content>"`, plus `wait_state: "nonempty"` for text that streams in, or `wait_for: ".spinner", wait_state: "hidden"` to wait for a spinner to go. |
| Content is there only some of the time, after a delay | `wait_min_ms: 2000` (a minimum delay before checking). |
| A consent wall, interstitial or one of several layouts | `wait_rules: [{ "if": "#consent", "then": "#results" }]` - the first visible `if` replaces `wait_for` (`detect_ms` sets how long to probe). |
| Wrong language, prices or "not available in your country" | `location: "<country>"`. |
| The page never stops changing (tickers, ads) | `wait_for: "<selector>"` instead of `stable`, and/or a lower `settle_ms` (a ceiling on settling, not a delay). |
| A plain fetch came back as an empty shell | Leave `render` unset (the API renders it) or set `render: true`. |

Read the response before retrying:

- `readiness.status`: `satisfied` (the wait condition was met), `timeout`, or
  `unavailable`; `readiness.reason` and `waited_ms` say more;
  `readiness.scroll_steps` how many scrolls ran.
- `wait_timed_out: true`: the wait hit its limit and the page was captured as is.
- `readiness.verification.status: "interactive"`: a Turnstile checkbox wants a
  human click; waiting will not help.

Each fetch with new options is a new request (1 credit if it succeeds). In an
app, find the options that work for a site once and store them with the site,
or put them in a template (templates carry their own wait settings).

Parsing tips: the HTML is the rendered DOM. Custom elements often carry the data
as attributes (reddit's `<shreddit-post post-title="…" score="…">`), so select
elements and read attributes rather than only text.
