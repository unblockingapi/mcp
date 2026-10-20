/**
 * Shaping a fetched page for a model, inside the MCP server: the API returns
 * whole HTML pages (often 0.5–2 MB once a feed has rendered), which would
 * blow any context window and get cut at max_chars long before the content
 * the agent wanted. Two levers, both applied here rather than in the API so
 * they cost no extra request:
 *
 *   - format: Markdown (the default) keeps headings, links, lists and text
 *     and drops markup: a 1.16 MB reddit listing becomes ~50 KB.
 *   - select: a CSS selector keeps only the matching elements (e.g. the
 *     posts of a feed, the rows of a table), as HTML or Markdown.
 *
 * And a short-lived copy of each fetched page (PageCache) so an agent can
 * re-slice the same page — another selector, the other format — without
 * fetching (and paying for) it again.
 */
import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { ApiResult } from "./client.js";

export type BodyFormat = "markdown" | "html";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "iframe", "template", "svg" as keyof HTMLElementTagNameMap]);

export function toMarkdown(html: string): string {
  return turndown
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface Selection {
  /** How many elements matched. */
  matched: number;
  body: string;
}

/**
 * The elements matching `selector`, as HTML (outerHTML, attributes and all —
 * custom elements often keep their data there) or Markdown, separated by a
 * rule. Throws on an invalid selector.
 */
export function selectFrom(html: string, selector: string, format: BodyFormat): Selection {
  const { document } = parseHTML(html);
  const elements = [...document.querySelectorAll(selector)] as Element[];
  const parts = elements.map((el) => (format === "html" ? el.outerHTML : toMarkdown(el.outerHTML)));
  return { matched: elements.length, body: parts.join(format === "html" ? "\n\n" : "\n\n---\n\n") };
}

/** The body the model sees for a non-JSON result, before truncation. */
export function shapeBody(html: string, format: BodyFormat, select?: string): { body: string; matched?: number; selectError?: string } {
  if (select) {
    try {
      const { matched, body } = selectFrom(html, select, format);
      return { body, matched };
    } catch (err) {
      return { body: format === "html" ? html : toMarkdown(html), selectError: (err as Error).message };
    }
  }
  return { body: format === "html" ? html : toMarkdown(html) };
}

/**
 * The last pages fetched, kept for a few minutes so refining one (another
 * `select`, the other `format`) reuses it instead of spending a credit.
 * Keyed by the caller's key and the fetch parameters, so callers never see
 * each other's pages and a different fetch (another wait, more scrolling)
 * always goes to the API. Bounded by total size; oldest out first.
 */
export class PageCache {
  private entries = new Map<string, { at: number; result: ApiResult; size: number }>();
  private bytes = 0;

  constructor(
    private readonly ttlMs = 10 * 60_000,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {}

  static key(apiKey: string, fetchParams: object): string {
    return createHash("sha256").update(apiKey).update("\0").update(JSON.stringify(fetchParams)).digest("hex");
  }

  get(key: string, now = Date.now()): { result: ApiResult; ageMs: number } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at > this.ttlMs) {
      this.delete(key);
      return undefined;
    }
    return { result: entry.result, ageMs: now - entry.at };
  }

  set(key: string, result: ApiResult, now = Date.now()): void {
    const size = typeof result.response === "string" ? result.response.length : JSON.stringify(result.response ?? null).length;
    if (size > this.maxBytes / 4) return;
    this.delete(key);
    this.entries.set(key, { at: now, result, size });
    this.bytes += size;
    for (const [oldest] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(oldest);
    }
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.size;
    this.entries.delete(key);
  }
}
