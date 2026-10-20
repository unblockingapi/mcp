# Recipe: listings aggregator

One page that lists properties (or jobs, cars, products) from several sites,
normalised into one schema, with filters and links back to the source.

## 1. Pick the sources and how to read each

For each source site, in this order:

1. A published template: look up its host in
   `https://api.unblockingapi.com/templates.json?limit=200` (or `find_templates`
   in an MCP session). Property examples: `kjellberg/idealista-search` (idealista.com
   search pages, Spain), `kjellberg/hi-homes-search`, `kjellberg/serneholt-estates-search`,
   `kjellberg/marbella-living-search`. Check the output shape (see the
   `templates` guide).
2. No template: build one in the visual editor (https://editor.unblockingapi.com)
   from a search-results page, then call it by name. This is the most robust
   option for sites you'll fetch every day.
3. Or fetch the HTML and parse the listing cards in code.

Use the source's search/listing pages (with filters in the URL), not one request
per property: a results page yields 20-50 listings per credit. Fetch detail pages
only for listings you show in full.

## 2. Normalise

```ts
type Listing = {
  source: string;          // "idealista"
  sourceId: string;        // the site's id or the URL
  url: string;             // link back to the original
  title: string;
  price: number | null;    // parsed number
  currency: string;        // "EUR"
  location: string;
  bedrooms: number | null;
  areaM2: number | null;
  image: string | null;
  fetchedAt: string;
};
```

Write one small mapper per source from its template output to `Listing`; parse
prices and sizes defensively (strip currency symbols, thousands separators).

## 3. Refresh

- A scheduled job per source (every few hours is plenty for real estate), with
  `location` set to the source's country.
- Upsert by `(source, sourceId)`; keep `firstSeenAt` and `lastSeenAt`, and hide
  listings not seen in the last few runs.
- Deduplicate across sources by a normalised key (address + price + size) when
  agencies list the same property.
- Store images as URLs pointing to the source (or cache them yourself if the
  terms allow); always link back to the original listing.

## 4. The page

Filters (price range, area, bedrooms, source), sorting (newest, price), cards
with image, price, key facts and the source's name, and a detail view linking
out. Serve from your database, never by fetching live on page load.

## Cost

One credit per results page per refresh. 5 sources x 3 search pages x 4 runs a
day = ~1,800 credits/month.
