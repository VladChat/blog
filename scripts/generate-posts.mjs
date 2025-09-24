#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Parser from "rss-parser";
import slugify from "slugify";
import yaml from "js-yaml";
import { DateTime } from "luxon";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const CONFIG_DIR = path.join(ROOT_DIR, "config");
const CACHE_FILE = path.join(ROOT_DIR, ".cache", "state.json");
const POSTS_ROOT = path.join(ROOT_DIR, "src", "posts");

const parser = new Parser();

const DEFAULT_STATE = {
  seenGuids: [],
  keywordIndex: 0,
  keywords: {},
};

async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

async function loadState() {
  try {
    const stat = await fs.stat(CACHE_FILE);
    if (!stat.isFile()) {
      return { ...DEFAULT_STATE };
    }
    return { ...DEFAULT_STATE, ...JSON.parse(await fs.readFile(CACHE_FILE, "utf-8")) };
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
      return { ...DEFAULT_STATE };
    }
    throw error;
  }
}

async function saveState(state, { dryRun }) {
  if (dryRun) {
    return;
  }
  await fs.writeFile(CACHE_FILE, JSON.stringify(state, null, 2));
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    verbose: false,
    posts: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--posts") {
      const next = argv[++i];
      if (!next) {
        throw new Error("Missing value for --posts");
      }
      const value = Number.parseInt(next, 10);
      if (Number.isNaN(value) || value <= 0) {
        throw new Error("--posts requires a positive integer");
      }
      options.posts = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseFeedList(value) {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSummary(item) {
  return (
    item.contentSnippet ||
    item.summary ||
    item.content ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(item) {
  if (item.isoDate) {
    const date = DateTime.fromISO(item.isoDate, { zone: "utc" });
    if (date.isValid) {
      return date;
    }
  }
  if (item.pubDate) {
    const date = DateTime.fromJSDate(new Date(item.pubDate));
    if (date.isValid) {
      return date.toUTC();
    }
  }
  return null;
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
    return feed.items.map((item) => {
      const publishedAt = parseDate(item);
      return {
        guid: item.guid || item.id || item.link,
        title: item.title || "",
        link: item.link,
        publishedAt,
        summary: normalizeSummary(item),
        source: feed.title || simplifyHostname(item.link),
        rawSource: item.source || simplifyHostname(item.link),
        feedUrl: url,
      };
    });
  } catch (error) {
    if (verbose) {
      console.warn(`Failed to load feed ${url}: ${error.message || error}`);
    }
    return [];
  }
}

function renderTemplate(template, variables) {
  return template.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const value = variables[key.trim()];
    return value == null ? "" : String(value);
  });
}

function formatFrontMatter(data) {
  return `---\n${yaml.dump(data, { lineWidth: 80 })}---\n\n`;
}

function sanitizeDescription(description) {
  const trimmed = description.trim();
  if (trimmed.length <= 160) {
    return trimmed;
  }
  return `${trimmed.slice(0, 157).trimEnd()}…`;
}

function ensureTitleLength(title) {
  const trimmed = title.trim();
  if (trimmed.length <= 70) {
    return trimmed;
  }
  return `${trimmed.slice(0, 67).trimEnd()}…`;
}

function countWords(text) {
  return text
    .replace(/[\n#*\-`>]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function buildBody(sections) {
  return sections
    .map(({ heading, body }) => {
      const safeHeading = heading.replace(/\n/g, " ").trim();
      const safeBody = body.trim();
      return `## ${safeHeading}\n\n${safeBody}`;
    })
    .join("\n\n");
}

async function callOpenAI({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${text}`);
  }
  const payload = await response.json();
  const choice = payload?.choices?.[0]?.message?.content;
  if (!choice) {
    throw new Error("OpenAI API returned no content");
  }
  return choice;
}

async function generateArticle({
  apiKey,
  models,
  promptConfig,
  keyword,
  newsItem,
  timezone,
  config,
}) {
  const variables = {
    KEYWORD: keyword,
    NEWS_HEADLINE: newsItem.title,
    NEWS_SUMMARY: newsItem.summary || "",
    NEWS_LINK: newsItem.link,
    NEWS_SOURCE: newsItem.rawSource || newsItem.source,
    NEWS_PUBLISHED: newsItem.publishedAt
      ? newsItem.publishedAt.setZone(timezone).toISO()
      : "",
  };
  const systemPrompt = promptConfig.post.system;
  const userPrompt = renderTemplate(promptConfig.post.user, variables);
  const modelsToTry = [...new Set([models.defaultModel, models.fallbackModel].filter(Boolean))];

  let content;
  let lastError;
  for (const model of modelsToTry) {
    try {
      content = await callOpenAI({
        apiKey,
        model,
        systemPrompt,
        userPrompt,
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!content) {
    throw lastError || new Error("OpenAI call failed");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse OpenAI response as JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed.sections) || parsed.sections.length < config.minSections) {
    throw new Error(
      `Generated article does not include at least ${config.minSections} sections`
    );
  }

  const body = buildBody(parsed.sections);
  const wordCount = countWords(body);
  if (wordCount < config.minWords) {
    throw new Error(
      `Generated article is too short (${wordCount} words, minimum ${config.minWords})`
    );
  }
  if (config.maxWords && wordCount > config.maxWords) {
    throw new Error(
      `Generated article exceeds maximum word count (${wordCount} > ${config.maxWords})`
    );
  }
  if ((body.match(/##\s/g) || []).length < config.minSections) {
    throw new Error("Generated article is missing required section headings");
  }
  if (body.includes("{{") || body.includes("}}")) {
    throw new Error("Generated article contains unresolved placeholders");
  }

  const tags = Array.isArray(parsed.tags) ? parsed.tags.map((tag) => String(tag)) : [];
  if (!tags.some((tag) => tag.toLowerCase().includes(keyword.toLowerCase()))) {
    tags.unshift(keyword);
  }
  if (!tags.includes("posts")) {
    tags.push("posts");
  }

  return {
    title: ensureTitleLength(parsed.title || newsItem.title),
    description: sanitizeDescription(parsed.description || newsItem.summary || newsItem.title),
    tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
    body,
    wordCount,
    conclusion: parsed.conclusion ? parsed.conclusion.trim() : "",
  };
}

function buildSourcesList(mainItem, additionalItems, limit, timezone) {
  const all = [mainItem, ...additionalItems]
    .filter((item) => item && item.link)
    .slice(0, limit);
  return all.map((item) => ({
    title: item.title,
    url: item.link,
    source: simplifyHostname(item.link) || item.source,
    published: item.publishedAt
      ? item.publishedAt.setZone(timezone).toISO()
      : "",
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [newsConfig, keywords, promptConfig, models, state] = await Promise.all([
    readJson(path.join(CONFIG_DIR, "news.config.json")),
    readJson(path.join(CONFIG_DIR, "keywords.json")),
    readJson(path.join(CONFIG_DIR, "prompts.json")),
    readJson(path.join(CONFIG_DIR, "models.json")),
    loadState(),
  ]);

  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error("config/keywords.json must contain at least one keyword");
  }
  if (!models?.defaultModel) {
    throw new Error("config/models.json must define a defaultModel");
  }

  const timezone = newsConfig.timezone || "UTC";
  const postsTarget = options.posts || newsConfig.postsPerRun || 1;

  const feedUrls = new Set([
    ...(newsConfig.rssFeeds || []),
    ...parseFeedList(process.env.NEWS_FEEDS_GENERAL),
  ]);

  const queryTemplate = process.env.NEWS_FEEDS_QUERY;
  if (queryTemplate) {
    keywords.forEach((keyword) => {
      const encodedKeyword = encodeURIComponent(keyword);
      const queryUrl = queryTemplate
        .replace(/\{\{KEYWORD\}\}/g, encodedKeyword)
        .replace(/\{\{KEYWORD_PLAIN\}\}/g, keyword);
      feedUrls.add(queryUrl);
    });
  }

  const now = DateTime.utc();
  const horizon = now.minus({ hours: newsConfig.horizonHours || 24 });

  const feedResults = await Promise.all(
    Array.from(feedUrls)
      .filter(Boolean)
      .map((url) => fetchFeed(url, { verbose: options.verbose }))
  );
  const allItems = feedResults.flat().filter((item) => {
    if (!item.guid || !item.link) {
      return false;
    }
    if (!item.publishedAt) {
      return true;
    }
    return item.publishedAt >= horizon;
  });

  const seen = new Set(state.seenGuids || []);
  const uniqueItems = [];
  const seenLinks = new Set();
  for (const item of allItems) {
    if (seen.has(item.guid) || seenLinks.has(item.link)) {
      continue;
    }
    seenLinks.add(item.link);
    uniqueItems.push(item);
  }

  uniqueItems.sort((a, b) => {
    const aTime = a.publishedAt ? a.publishedAt.toMillis() : 0;
    const bTime = b.publishedAt ? b.publishedAt.toMillis() : 0;
    return bTime - aTime;
  });

  const selected = uniqueItems.slice(0, postsTarget);
  if (selected.length === 0) {
    console.log("No fresh news items available within the configured horizon.");
    return;
  }

  const keywordsQueue = [];
  let keywordIndex = state.keywordIndex || 0;
  for (let i = 0; i < selected.length; i++) {
    const keyword = keywords[(keywordIndex + i) % keywords.length];
    keywordsQueue.push(keyword);
  }

  if (options.dryRun) {
    console.log(`Planned posts (${selected.length}):`);
    selected.forEach((item, idx) => {
      const keyword = keywordsQueue[idx];
      const slug = slugify(`${keyword} ${item.title}`, { lower: true, strict: true });
      console.log(
        `- ${keyword} → ${item.title} (${slug || "untitled"})`
      );
    });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const createdPosts = [];
  for (let i = 0; i < selected.length; i++) {
    const newsItem = selected[i];
    const keyword = keywordsQueue[i];

    const relatedSources = uniqueItems
      .filter((item) => item !== newsItem && simplifyHostname(item.link) === simplifyHostname(newsItem.link));
    try {
      const article = await generateArticle({
        apiKey,
        models,
        promptConfig,
        keyword,
        newsItem,
        timezone,
        config: newsConfig,
      });
      const slug = slugify(article.title || `${keyword}-${newsItem.title}`, {
        lower: true,
        strict: true,
      });
      const slugValue = slug || slugify(`${keyword}-${newsItem.publishedAt?.toISODate() || Date.now()}`, {
        lower: true,
        strict: true,
      });
      const publishDate = DateTime.now().setZone(timezone);
      const postDir = path.join(
        POSTS_ROOT,
        publishDate.toFormat("yyyy"),
        publishDate.toFormat("LL"),
        slugValue
      );
      await fs.mkdir(postDir, { recursive: true });

      const sources = buildSourcesList(
        newsItem,
        relatedSources,
        newsConfig.sourcesPerPost || 1,
        timezone
      );

      const frontMatter = {
        title: article.title,
        description: article.description,
        date: publishDate.toISO(),
        tags: article.tags,
        sources,
        layout: "layouts/post.njk",
      };
      const bodyContent = article.conclusion
        ? `${article.body}\n\n${article.conclusion}`
        : article.body;
      const output = `${formatFrontMatter(frontMatter)}${bodyContent}\n`;
      await fs.writeFile(path.join(postDir, "index.md"), output, "utf-8");

      createdPosts.push({
        keyword,
        slug: slugValue,
        path: path.relative(ROOT_DIR, path.join(postDir, "index.md")),
        guid: newsItem.guid,
      });
      if (options.verbose) {
        console.log(`Created post: ${keyword} → ${slugValue}`);
      }
    } catch (error) {
      console.error(`Failed to generate article for '${newsItem.title}': ${error.message}`);
    }
  }

  if (createdPosts.length === 0) {
    console.log("No posts generated.");
    return;
  }

  const maxEntries = newsConfig.maxStateEntries || 200;
  const updatedState = {
    ...state,
    keywordIndex: (state.keywordIndex + createdPosts.length) % keywords.length,
    seenGuids: [...(state.seenGuids || []), ...createdPosts.map((post) => post.guid)].slice(-maxEntries),
    keywords: {
      ...(state.keywords || {}),
    },
  };

  createdPosts.forEach((post) => {
    updatedState.keywords[post.keyword] = (updatedState.keywords[post.keyword] || 0) + 1;
  });

  await saveState(updatedState, { dryRun: options.dryRun });
  createdPosts.forEach((post) => {
    console.log(`Generated: ${post.keyword} → ${post.slug}`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
