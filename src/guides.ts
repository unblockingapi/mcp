/**
 * Guides for building apps on UnblockingAPI, served by the get_build_guide
 * tool. They live as Markdown in guides/ at the package root (shipped in the
 * npm package and the image) so they read as docs on GitHub too. This is how
 * the "skill" reaches every MCP client: a tool every client can call, rather
 * than an Agent Skill only some clients support and users must install.
 */
import { readFile } from "node:fs/promises";

export const GUIDE_TOPICS = [
  { topic: "api", summary: "the REST API for apps: request, response, errors, timeouts, keeping the key server-side." },
  { topic: "fetch-tuning", summary: "getting complete pages: scrolling, waiting for content, consent walls, locations." },
  { topic: "templates", summary: "finding and calling templates for JSON, their output shapes, building your own." },
  { topic: "rank-tracker", summary: "recipe: a Google rank tracker for keywords and domains." },
  { topic: "listings-aggregator", summary: "recipe: one page that aggregates listings (e.g. properties) from several sites." },
  { topic: "price-monitor", summary: "recipe: watch product prices and alert on changes." },
] as const;

export type GuideTopic = (typeof GUIDE_TOPICS)[number]["topic"];

const GUIDES_DIR = new URL("../guides/", import.meta.url);

export async function readGuide(topic: GuideTopic): Promise<string> {
  const text = await readFile(new URL(`${topic}.md`, GUIDES_DIR), "utf8");
  const others = GUIDE_TOPICS.filter((g) => g.topic !== topic)
    .map((g) => `- ${g.topic}: ${g.summary}`)
    .join("\n");
  return `${text.trim()}\n\n---\nOther guides (get_build_guide topic):\n${others}`;
}
