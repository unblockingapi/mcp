# Recipe: price monitor

Watch product pages and alert when a price changes or drops below a target.

## Data model

- `products`: url, name, target_price (optional), currency, location (country
  the price should be seen from), check_interval.
- `price_checks`: product_id, checked_at, price, in_stock, raw (what was parsed).

## Fetching

1. Look for a template for the shop (`templates.json` or `find_templates`); if
   there is none and you track many products on one shop, build one in the
   visual editor (title, price, availability) and call it by name.
2. Otherwise fetch the page and parse the price in code. Prefer structured data
   in the HTML: scripts (JSON-LD included) are stripped from responses, but
   `itemprop="price"` / `data-price` attributes and meta tags
   (`product:price:amount`) usually survive; fall back to the price element's text.
3. Set `location` so prices, currency and stock are the ones your users see.
4. Product pages often fill prices in with JavaScript; leave `render` unset (the
   API renders when needed) and add `wait_for: "<price selector>"` with
   `wait_state: "nonempty"` if the first fetches miss it.

## Checking and alerting

- A scheduled job (hourly or daily per product), worker pool of 3-5, retries
  for 429/503/504.
- Compare with the previous check; on a change, store it and notify (email,
  Slack webhook, push). On a drop below `target_price`, send the alert once
  until it rises again.
- Treat a parse failure as "unknown", not as a price of 0, and surface it in the UI.

## UI

Product list with current price, change, last checked and a mini chart; a
product detail with the price history; add products by pasting a URL.

## Cost

1 credit per product per check. 50 products checked twice a day = ~3,000
credits/month.
