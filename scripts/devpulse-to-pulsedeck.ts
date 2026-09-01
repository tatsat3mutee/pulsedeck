#!/usr/bin/env -S npx tsx
/**
 * devpulse-to-pulsedeck: read the JSON a `devpulse` topic endpoint returns,
 * write a pulsedeck-valid Markdown deck.
 *
 * Reads the exact shape `GET /api/topics/:slug` returns, matched against
 * `backend/src/routes/topics.ts` and the `topics`/`items` tables in
 * `sql/001_schema.sql` (plus `image_url`/`author`/`duration` added in
 * `sql/006_portal_upgrade.sql`) in tatsat3mutee/devpulse:
 *
 *   {
 *     id, name, slug, category, category_color, description,
 *     first_seen, last_updated,
 *     items: [{
 *       id, source_id, topic_id, title, description, url, type, platform,
 *       tags: string[], score, is_bookmarked, published_at, fetched_at,
 *       metadata, source_name, image_url, author, duration
 *     }],
 *     type_counts: [{ type, count }],
 *   }
 *
 * No dependency on devpulse's or pulsedeck's source — this reads one
 * project's output format and writes the other's input format.
 *
 * Usage:
 *   npx tsx scripts/devpulse-to-pulsedeck.ts <topic.json|url> [--out deck.md] [--per-group 6]
 *
 * Examples:
 *   npx tsx scripts/devpulse-to-pulsedeck.ts https://devpulse.example.com/api/topics/agentic-ai --out decks/agentic-ai.md
 *   npx tsx scripts/devpulse-to-pulsedeck.ts ./topic-sample.json | node dist/index.js -
 */

import { readFileSync, writeFileSync } from "fs";

interface DevpulseItem {
  id: number;
  title: string;
  description: string | null;
  url: string;
  type: string;
  platform: string;
  tags: string[];
  /**
   * `items.score` is `NUMERIC(8,2)` in Postgres, and node-postgres returns
   * `NUMERIC` as a string to avoid float precision loss — confirmed against
   * a real `GET /api/topics/:slug` response (`"score":"91.50"`, not `91.5`).
   * Always read this through `scoreOf`, never compare or format it directly.
   */
  score: number | string;
  is_bookmarked: boolean;
  published_at: string | null;
  fetched_at: string;
  metadata: Record<string, unknown>;
  source_name: string | null;
  image_url?: string | null;
  author?: string | null;
  duration?: string | null;
}

interface DevpulseTypeCount {
  type: string;
  count: number;
}

interface DevpulseTopic {
  id: number;
  name: string;
  slug: string;
  category: string;
  category_color: string;
  description: string | null;
  first_seen: string;
  last_updated: string;
  items: DevpulseItem[];
  type_counts: DevpulseTypeCount[];
}

/**
 * Every `items.type` value the devpulse codebase actually writes, confirmed
 * against `frontend/src/components/FeedItem.tsx`'s own `typeLabel` map and a
 * source-wide grep for `type: "..."` literals (paper, repo, social, news,
 * article, video — no `model` or `community` values exist in the app as
 * shipped). A type this map does not know about — future schema drift, a new
 * fetcher — still gets a readable group label instead of failing: see
 * `labelFor`.
 */
const TYPE_LABELS: Record<string, string> = {
  paper: "Papers",
  repo: "Repos",
  social: "Discussions",
  news: "News",
  article: "Articles",
  video: "Videos",
};

function labelFor(type: string): string {
  if (TYPE_LABELS[type]) return TYPE_LABELS[type];
  // Unknown type: Title Case the raw value rather than dropping it silently.
  return type
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Neutralizes exactly the two things that corrupt a deckrun table cell or slide. */
function mdEscape(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

/**
 * A line that is exactly `---` breaks a slide even inside prose (deckrun's
 * slide separator is not fence-aware). Titles and descriptions are pulled
 * from live feed data, so guard against one landing on its own line.
 */
function guardSeparator(text: string): string {
  return text.replace(/^---$/gm, "———");
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** `item.score` arrives as a string from Postgres `NUMERIC` — see the field's doc comment. */
function scoreOf(item: DevpulseItem): number {
  const n = Number(item.score);
  return Number.isFinite(n) ? n : 0;
}

function groupByType(items: DevpulseItem[]): Map<string, DevpulseItem[]> {
  const groups = new Map<string, DevpulseItem[]>();
  for (const item of items) {
    const key = item.type || "news";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => scoreOf(b) - scoreOf(a));
  }
  return groups;
}

function renderGroupSlide(type: string, items: DevpulseItem[], perGroup: number): string {
  const top = items.slice(0, perGroup);
  const rows = top
    .map((item) => {
      const title = mdEscape(truncate(item.title, 90));
      const source = mdEscape(item.source_name || item.platform || "");
      const score = scoreOf(item).toFixed(0);
      const date = formatDate(item.published_at);
      return `| [${title}](${item.url}) | ${source} | ${score} | ${date} |`;
    })
    .join("\n");

  return [
    `## ${labelFor(type)}`,
    "",
    "| Item | Source | Score | Published |",
    "| ---- | ------ | ----- | --------- |",
    rows,
  ].join("\n");
}

export function topicToDeck(topic: DevpulseTopic, perGroup = 6): string {
  const groups = groupByType(topic.items ?? []);
  // Stable, predictable order: by total count descending (matches the
  // `type_counts` the API already ranks), falling back to items-array order
  // for any type missing from `type_counts`.
  const orderedTypes = [
    ...(topic.type_counts ?? []).map((tc) => tc.type),
    ...[...groups.keys()].filter((t) => !(topic.type_counts ?? []).some((tc) => tc.type === t)),
  ];

  const totalItems = topic.items?.length ?? 0;
  const description = guardSeparator(mdEscape(topic.description) || "");

  const titleSlide = [
    `# ${guardSeparator(topic.name)}`,
    "",
    `### ${topic.category}`,
    "",
    description || `${totalItems} items tracked by devpulse.`,
    "",
    description ? `<!-- notes: ${description.replace(/-->/g, "—>")} -->` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const groupSlides = orderedTypes
    .map((type) => groups.get(type))
    .filter((items): items is DevpulseItem[] => !!items && items.length > 0)
    .map((items) => renderGroupSlide(items[0].type, items, perGroup));

  return [titleSlide, ...groupSlides].join("\n\n---\n\n") + "\n";
}

async function loadTopic(source: string): Promise<DevpulseTopic> {
  const raw = /^https?:\/\//.test(source)
    ? await (await fetch(source)).text()
    : readFileSync(source, "utf-8");
  return JSON.parse(raw) as DevpulseTopic;
}

async function main() {
  const args = process.argv.slice(2);
  const source = args.find((a) => !a.startsWith("--"));
  const outIdx = args.indexOf("--out");
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const perGroupIdx = args.indexOf("--per-group");
  const perGroup = perGroupIdx !== -1 ? Number.parseInt(args[perGroupIdx + 1], 10) : 6;

  if (!source) {
    console.error(
      "Usage: devpulse-to-pulsedeck.ts <topic.json|url> [--out deck.md] [--per-group 6]"
    );
    process.exitCode = 2;
    return;
  }

  const topic = await loadTopic(source);
  const markdown = topicToDeck(topic, Number.isFinite(perGroup) ? perGroup : 6);

  if (outPath) {
    writeFileSync(outPath, markdown, "utf-8");
    console.error(`Wrote ${outPath}`);
  } else {
    process.stdout.write(markdown);
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
