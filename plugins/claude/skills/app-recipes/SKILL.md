---
name: app-recipes
description: Use when building a rank tracker (Google positions for keywords and domains), a price monitor (product prices and alerts) or a listings aggregator (properties, jobs, cars or products from several sites in one place) on UnblockingAPI, or a similar app that fetches web pages on a schedule and stores what changed.
---

# App recipes on UnblockingAPI

Complete designs for the apps people most often build on UnblockingAPI: data
model, fetching code, scheduling, cost and UI. Read the one that fits before
planning, and adapt it to the user's stack:

| The user wants | Read |
| --- | --- |
| Google positions for keywords and domains over time | `references/rank-tracker.md` |
| Product prices watched, with alerts on changes or a target price | `references/price-monitor.md` |
| Listings from several sites, normalised into one searchable page | `references/listings-aggregator.md` |

For something close but different (a news monitor, a job board, a stock
checker), take the nearest recipe: they share the same shape.

## The shape every recipe shares

1. **Sources first.** For each site, look for a template (`find_templates` with
   a real URL from that site, or the `templates` skill); fall back to parsing
   HTML only when none fits.
2. **Store every check.** One table for what is watched, one for each check
   with a timestamp, so the app can show history and change.
3. **Fetch on a schedule, in the background.** A scheduled job with a worker
   pool of 3-5, a 180 s timeout and backoff on 429/503/504, never inside a web
   request. The `build-app` skill has the rules.
4. **Tell the user the cost.** 1 credit per successful fetch: items x checks
   per day x 30 per month. Suggest the slowest schedule that still serves them.

Start with a working fetch of one real URL from each source before building
the rest. In this conversation, `unblock_fetch` with `template` set shows the
exact JSON the app will receive.
