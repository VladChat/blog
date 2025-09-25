#!/usr/bin/env node
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import Parser from "rss-parser";
import slugify from "slugify";
import matter from "gray-matter";
import { DateTime } from "luxon";
import OpenAI from "openai";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");
const CONFIG_DIR = path.join(ROOT_DIR, "config");
const CACHE_FILE = path.join(ROOT_DIR, ".cache", "state.json");
const POSTS_ROOT = path.join(ROOT_DIR, "src", "posts");
const SAMPLE_HEADLINES_FILE = path.join(CONFIG_DIR, "sample-headlines.json");

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "VladChatBot/1.0 (+https://vladchat.github.io/blog)",
    Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
  },
});

const DEFAULT_STATE = {
  generated: [],
  keywordIndex: 0,
  seenGuids: [],
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    verbose: false,
    posts: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--posts") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --posts");
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error("--posts expects a positive integer");
      }
      options.posts = parsed;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function readJson(filePath) {
  const content = await fsp.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

async function loadState() {
  try {
    const content = await fsp.readFile(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(content);
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    if (error.code === "ENOENT") {
      await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fsp.writeFile(CACHE_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
      return { ...DEFAULT_STATE };
    }
    throw error;
  }
}

async function saveState(state) {
  await fsp.writeFile(CACHE_FILE, JSON.stringify(state, null, 2));
}

async function loadSampleHeadlines() {
  try {
    const entries = await readJson(SAMPLE_HEADLINES_FILE);
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries
      .map((entry, index) => {
        if (!entry?.title || !entry?.link) {
          return null;
        }
        const publishedAt = entry.publishedAt
          ? DateTime.fromISO(entry.publishedAt, { zone: "utc" })
          : DateTime.now().minus({ hours: index + 1 });
        return {
          guid: entry.guid || `${entry.link}#sample-${index}`,
          title: sanitizeWhitespace(entry.title),
          link: entry.link,
          summary: sanitizeWhitespace(entry.summary || entry.description || ""),
          publishedAt: publishedAt.isValid ? publishedAt : null,
          feedTitle: entry.feedTitle || "Sample Feed",
        };
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function sanitizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function simplifyHostname(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return hostname.replace(/^www\./i, "");
  } catch (error) {
    return "";
  }
}

async function fetchFeed(url, { verbose }) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items
      .map((item) => {
        const guid = item.guid || item.id || item.link;
        if (!guid || !item.link || !item.title) {
          return null;
        }
        const publishedAt = item.isoDate
          ? DateTime.fromISO(item.isoDate, { zone: "utc" })
          : item.pubDate
          ? DateTime.fromJSDate(new Date(item.pubDate), { zone: "utc" })
          : null;
        return {
          guid,
          title: sanitizeWhitespace(item.title),
          link: item.link,
          summary: sanitizeWhitespace(item.contentSnippet || item.summary || item.content || ""),
          publishedAt: publishedAt && publishedAt.isValid ? publishedAt : null,
          feedTitle: feed.title || simplifyHostname(item.link),
        };
      })
      .filter(Boolean);
  } catch (error) {
    if (verbose) {
      const reason = error && error.message ? error.message : String(error);
      console.warn(`Failed to load feed ${url}: ${reason}`);
      if (error && Array.isArray(error.errors)) {
        error.errors.forEach((err, idx) => {
          const detail = err && err.message ? err.message : String(err);
          console.warn(`  [${idx + 1}] ${detail}`);
        });
      }
    }
    return [];
  }
}

function buildSystemPrompt(writer, settings) {
  const lines = [
    "You are an automated newsroom assistant who writes original long-form articles.",
  ];
  if (writer?.tone) {
    lines.push(`Preferred tone: ${writer.tone}.`);
  }
  if (writer?.priority) {
    lines.push(`Content priority: ${writer.priority}.`);
  }
  lines.push("Follow the editorial rules strictly:");
  if (writer?.rules) {
    Object.entries(writer.rules).forEach(([key, rule]) => {
      lines.push(`- ${key}: ${rule}`);
    });
  }
  if (writer?.extras) {
    lines.push("Extras guidelines:");
    Object.entries(writer.extras).forEach(([feature, enabled]) => {
      lines.push(`- ${feature}: ${enabled ? "include when it adds value" : "omit"}`);
    });
  }
  lines.push(
    `Target word count between 1000 and ${settings.maxWords || 1400}. Respect the maximum.`
  );
  lines.push("Meta description must be 150-160 characters and include the keyword exactly once.");
  lines.push("Always conclude with a section titled 'Sources' that lists 1-3 bullet links from the provided URLs.");
  return lines.join("\n");
}

function formatSourcesList(items) {
  if (!items || items.length === 0) {
    return "(no sources available)";
  }
  return items
    .map((item) => `- ${item.title} (${simplifyHostname(item.link)}): ${item.link}`)
    .join("\n");
}

function renderPrompt(template, variables) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const name = key.trim();
    return variables[name] == null ? "" : String(variables[name]);
  });
}

function countWords(markdown) {
  return markdown
    .replace(/[`*_#>\-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function ensureMetaDescription(baseText, keyword, newsItem) {
  const keywordLower = keyword.toLowerCase();
  const strippedBase = sanitizeWhitespace(baseText).replace(
    new RegExp(escapeRegExp(keyword), "ig"),
    ""
  );
  const summary = strippedBase || sanitizeWhitespace(newsItem.summary) || sanitizeWhitespace(newsItem.title);
  const tail = ` Stay ahead with insights on ${keyword}.`;
  const maxBaseLength = Math.max(0, 160 - tail.length);
  let truncated = summary.slice(0, maxBaseLength).trim();
  if (truncated && !/[.!?]$/.test(truncated)) {
    truncated = `${truncated}.`;
  }
  let description = `${truncated}${tail}`.trim();

  const count = (description
    .toLowerCase()
    .match(new RegExp(escapeRegExp(keywordLower), "g")) || []).length;
  if (count === 0) {
    if (description.length + keyword.length + 1 <= 160) {
      description = `${description} ${keyword}`.trim();
    } else {
      description = `${keyword} ${description}`.slice(0, 160).trim();
    }
  } else if (count > 1) {
    const pieces = description.split(/(\b)/);
    let seen = 0;
    for (let i = 0; i < pieces.length; i += 1) {
      if (pieces[i].toLowerCase() === keywordLower) {
        seen += 1;
        if (seen > 1) {
          pieces[i] = "coverage";
        }
      }
    }
    description = pieces.join("").replace(/\s+/g, " ").trim();
  }

  description = description.replace(/\s+/g, " ").trim();
  if (description.length > 160) {
    description = description.slice(0, 160).trimEnd();
  }
  if (description.length < 150) {
    const filler = " Discover what it means for decision-makers.";
    description = `${description}${filler}`.slice(0, 160).trim();
  }

  let finalCount = (description
    .toLowerCase()
    .match(new RegExp(escapeRegExp(keywordLower), "g")) || []).length;
  if (finalCount === 0) {
    if (description.length + keyword.length + 1 <= 160) {
      description = `${description} ${keyword}`.trim();
    } else {
      description = `${keyword} ${description}`.slice(0, 160).trim();
    }
  } else if (finalCount > 1) {
    const tokens = description.split(/(\b)/);
    let seen = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].toLowerCase() === keywordLower) {
        seen += 1;
        if (seen > 1) {
          tokens[i] = "coverage";
        }
      }
    }
    description = tokens.join("").replace(/\s+/g, " ").trim();
  }

  description = description.replace(/\s+/g, " ").trim();
  if (description.length > 160) {
    description = description.slice(0, 160).trimEnd();
  }
  if (description.length < 150) {
    const filler = " Stay informed with concise analysis.";
    description = `${description}${filler}`.slice(0, 160).trim();
  }

  return description;
}

function ensureUniqueSlug(base, existing, targetDir) {
  let slug = slugify(base, { lower: true, strict: true });
  if (!slug) {
    slug = Date.now().toString(36);
  }
  let candidate = slug;
  let suffix = 1;
  while (
    existing.has(candidate) ||
    fs.existsSync(path.join(targetDir, candidate, "index.md"))
  ) {
    suffix += 1;
    candidate = `${slug}-${suffix}`;
  }
  existing.add(candidate);
  return candidate;
}

async function callOpenAI({ client, model, systemPrompt, userPrompt }) {
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [{ type: "text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "text", text: userPrompt }],
      },
    ],
  });

  const output = response.output_text || (response.output && response.output[0]?.content?.[0]?.text);
  if (!output) {
    throw new Error("OpenAI API returned no text");
  }
  return output.trim();
}

async function ensureDirectory(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function writePost({ dir, frontMatter, body }) {
  await ensureDirectory(dir);
  const markdown = matter.stringify(`${body.trim()}\n`, frontMatter, { lineWidth: 120 });
  await fsp.writeFile(path.join(dir, "index.md"), markdown, "utf-8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [settings, writer, prompts, keywords, state] = await Promise.all([
    readJson(path.join(CONFIG_DIR, "settings.json")),
    readJson(path.join(CONFIG_DIR, "writer.json")),
    readJson(path.join(CONFIG_DIR, "prompts.json")),
    readJson(path.join(CONFIG_DIR, "keywords.json")),
    loadState(),
  ]);

  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error("config/keywords.json must contain at least one keyword");
  }
  if (!Array.isArray(settings.newsFeeds) || settings.newsFeeds.length === 0) {
    throw new Error("config/settings.json must define at least one news feed URL");
  }
  if (!prompts.blogPrompt) {
    throw new Error("config/prompts.json must define blogPrompt");
  }

  const desiredPosts = options.posts || 1;
  const feedResults = await Promise.all(
    settings.newsFeeds.map((url) => fetchFeed(url, { verbose: options.verbose }))
  );
  let aggregatedItems = feedResults.flat();
  if (aggregatedItems.length === 0 && options.dryRun) {
    const sample = await loadSampleHeadlines();
    if (sample.length > 0) {
      console.log("Using sample headlines because live feeds were unavailable.");
      aggregatedItems = sample;
    }
  }
  if (aggregatedItems.length === 0) {
    console.log("No news items available from configured feeds.");
    return;
  }

  const seenGuids = new Set(state.seenGuids || []);
  let freshItems = aggregatedItems
    .filter((item) => !seenGuids.has(item.guid))
    .sort((a, b) => {
      const aTime = a.publishedAt ? a.publishedAt.toMillis() : 0;
      const bTime = b.publishedAt ? b.publishedAt.toMillis() : 0;
      return bTime - aTime;
    });

  if (freshItems.length === 0) {
    if (options.dryRun) {
      const sample = await loadSampleHeadlines();
      if (sample.length > 0) {
        console.log("Using sample headlines because live feeds were unavailable.");
        freshItems = sample;
      }
    }
    if (freshItems.length === 0) {
      console.log("All feed items have been processed previously.");
      return;
    }
  }

  const runDate = DateTime.now().setZone("utc");
  const today = runDate.toISODate();
  const year = runDate.toFormat("yyyy");
  const month = runDate.toFormat("LL");
  const targetDir = path.join(POSTS_ROOT, year, month);
  const assignments = [];
  const keywordIndex = state.keywordIndex || 0;
  for (let i = 0; i < freshItems.length && assignments.length < desiredPosts; i += 1) {
    const keyword = keywords[(keywordIndex + assignments.length) % keywords.length];
    const item = freshItems[i];
    const duplicate = (state.generated || []).some(
      (entry) => entry.keyword === keyword && entry.date === today
    );
    assignments.push({ item, keyword, duplicate });
  }

  if (assignments.length === 0) {
    console.log("No assignments could be prepared from the available items.");
    return;
  }

  const existingSlugs = new Set();
  const planned = assignments.map(({ item, keyword, duplicate }) => {
    const slug = ensureUniqueSlug(`${keyword} ${item.title}`, existingSlugs, targetDir);
    return { item, keyword, duplicate, slug };
  });

  if (options.dryRun) {
    console.log(`Planned posts (${planned.length}):`);
    planned.forEach(({ item, keyword, slug, duplicate }) => {
      const flag = duplicate ? " (skipped: already written today)" : "";
      console.log(`- ${keyword} → ${item.title} → ${slug}${flag}`);
    });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for generation");
  }
  const client = new OpenAI({ apiKey });
  const systemPrompt = buildSystemPrompt(writer, settings);

  const created = [];
  for (const assignment of planned) {
    const { item, keyword, slug, duplicate } = assignment;
    if (duplicate) {
      if (options.verbose) {
        console.log(`Skipping ${keyword} on ${today} because a post already exists.`);
      }
      seenGuids.add(item.guid);
      continue;
    }

    const supplementalSources = freshItems
      .filter((candidate) => candidate.link !== item.link)
      .slice(0, 2);
    const userPrompt = `${renderPrompt(prompts.blogPrompt, {
      NEWS_HEADLINE: item.title,
      KEYWORD: keyword,
    })}\n\nNews summary: ${item.summary || "(none)"}.\nPrimary source: ${item.link}\nAdditional sources:\n${formatSourcesList(supplementalSources)}\n`;

    try {
      const output = await callOpenAI({
        client,
        model: settings.model,
        systemPrompt,
        userPrompt,
      });

      const parsed = matter(output);
      const articleBody = sanitizeWhitespace(parsed.content).length
        ? parsed.content.trim()
        : output.trim();
      const wordCount = countWords(articleBody);
      if (options.verbose) {
        console.log(`Generated ${wordCount} words for ${keyword}`);
      }

      const frontMatter = {
        title: sanitizeWhitespace(parsed.data?.title) || item.title,
        description: ensureMetaDescription(parsed.data?.description, keyword, item),
        date: today,
        tags: [keyword, "auto"],
        layout: "layouts/post.njk",
      };

      const postDir = path.join(targetDir, slug);
      await writePost({ dir: postDir, frontMatter, body: articleBody });

      created.push({
        keyword,
        slug,
        date: today,
        guid: item.guid,
        path: path.relative(ROOT_DIR, path.join(postDir, "index.md")),
        wordCount,
      });
      seenGuids.add(item.guid);
      console.log(`Generated post: ${keyword} → ${slug}`);
    } catch (error) {
      console.error(`Failed to generate article for '${item.title}': ${error.message}`);
    }
  }

  if (created.length === 0) {
    console.log("No posts generated.");
    state.keywordIndex = (keywordIndex + assignments.length) % keywords.length;
    state.seenGuids = Array.from(seenGuids).slice(-500);
    await saveState(state);
    return;
  }

  const updatedGenerated = [...(state.generated || [])];
  created.forEach((entry) => {
    updatedGenerated.push({ keyword: entry.keyword, date: entry.date, slug: entry.slug });
  });
  const maxEntries = 500;
  state.generated = updatedGenerated.slice(-maxEntries);
  state.keywordIndex = (keywordIndex + assignments.length) % keywords.length;
  state.seenGuids = Array.from(seenGuids).slice(-1000);
  await saveState(state);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
