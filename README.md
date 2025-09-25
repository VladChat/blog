# AI-SEO News Blog

This repository implements a fully automated news publication built on Google’s [Eleventy High Performance Blog](https://www.industrialempathy.com/posts/eleventy-high-performance-blog/). Every day a GitHub Action gathers trusted RSS headlines, pairs them with SEO keywords, asks OpenAI to draft original coverage, and publishes the resulting Markdown to GitHub Pages.

## How it works

1. **Configuration first** – Update the JSON files in [`config/`](config/) to control feed sources, prompt wording, keyword rotation, and preferred OpenAI models.
2. **Scheduled generation** – The workflow defined in [`.github/workflows/auto-blog.yml`](.github/workflows/auto-blog.yml) runs daily (cron `0 13 * * *`) or on demand. It installs dependencies, runs `npm run generate`, commits any new posts, builds the Eleventy site, and deploys it to GitHub Pages.
3. **Content pipeline** – [`scripts/generate-posts.mjs`](scripts/generate-posts.mjs) fetches recent RSS items, assigns keywords round-robin, calls OpenAI with the configured prompt, and saves validated Markdown posts under `src/posts/YYYY/MM/slug/index.md` alongside YAML front matter that includes sources and metadata.
4. **Static publishing** – `npm run build` produces an optimized site in the `dist/` directory using the Eleventy High Performance Blog stack. Lighthouse-friendly defaults remain intact.

## Repository layout

```
config/              Runtime configuration for feeds, prompts, models, keywords
scripts/             Automation scripts (generate-posts.mjs)
src/                 Site content (posts, pages, assets entrypoints)
.cache/state.json    Keyword and GUID history to prevent duplicates
.github/workflows/   Automation pipeline for daily publishing
```

### Key configuration files

| File | Purpose |
| --- | --- |
| [`config/news.config.json`](config/news.config.json) | General automation settings: posts per run, time horizon, cron schedule, minimum/maximum word counts, timezone, RSS feeds, etc. |
| [`config/keywords.json`](config/keywords.json) | Ordered list of primary keywords. The generator rotates through this list so every run uses the next available term. |
| [`config/prompts.json`](config/prompts.json) | Prompt templates with `{{PLACEHOLDER}}` variables used to build the OpenAI request. Customize tone, structure, and required metadata here. |
| [`config/models.json`](config/models.json) | Preferred OpenAI model names (`defaultModel`, `fallbackModel`). |
| [`.cache/state.json`](.cache/state.json) | Automatically updated cache of used RSS GUIDs and keyword counters. Commit this file so runs remain deterministic. |

### Secrets and repository variables

Set the following under **Settings → Secrets and variables → Actions**:

| Type | Name | Notes |
| --- | --- | --- |
| Secret | `OPENAI_API_KEY` | Required to call the OpenAI API. Never commit this value. |
| Variable | `NEWS_FEEDS_GENERAL` | Optional comma- or newline-separated list of additional RSS feeds. |
| Variable | `NEWS_FEEDS_QUERY` | Optional feed template containing `{{KEYWORD}}` (URL-encoded) or `{{KEYWORD_PLAIN}}` (unencoded) placeholders for keyword-specific feeds. |

Grant the repository **Actions → General → Workflow permissions → Read and write** and enable GitHub Pages deployments via GitHub Actions.

## Local development

Install dependencies (Node.js 20+, see [`.nvmrc`](.nvmrc)) and run the automation locally before relying on CI:

```bash
npm install
npm run generate:dry   # Preview which headlines and keywords would be used without calling OpenAI
npm run generate       # Requires OPENAI_API_KEY in your environment
npm run build
npm start              # Starts Eleventy’s dev server at http://localhost:8080/
```

Generated posts live in `src/posts/<year>/<month>/<slug>/index.md`. Eleventy collections pick them up automatically thanks to [`src/posts/posts.11tydata.js`](src/posts/posts.11tydata.js), and the sitemap/RSS feeds are rebuilt on every deploy.

## Adding or editing content

- Update keyword rotation by editing [`config/keywords.json`](config/keywords.json).
- Modify prompts, tone, or output structure via [`config/prompts.json`](config/prompts.json).
- Adjust word counts, feed sources, or timezone in [`config/news.config.json`](config/news.config.json).
- Manual posts can still be authored by adding Markdown files under `src/posts/YYYY/MM/slug/index.md` that follow the same front matter structure (including a `sources` array).

Static pages such as [About](src/about/index.md) and [Sources Policy](src/sources-policy/index.md) are maintained in `src/` and use the existing Eleventy layouts.

## Automation safeguards

- RSS items older than the configured `horizonHours` are skipped.
- Previously used GUIDs are tracked in `.cache/state.json` to avoid duplicates.
- Each generated article must include at least four `##` sections and meet the configured word-count range before it is written to disk.
- Source attribution is stored in front matter (`sources` array) and rendered by the existing post layout.
- API failures gracefully log an error and continue processing remaining stories.

## Deployment

GitHub Pages is deployed through the `auto-blog` workflow. Successful runs upload the `dist/` directory using the official `actions/deploy-pages` action. Ensure GitHub Pages is configured to use **GitHub Actions** as the deployment source under **Settings → Pages**.

## Credits

This project builds on Google’s Eleventy High Performance Blog starter and keeps all of its performance optimizations, including critical CSS inlining, responsive image pipelines, AMP optimization, and strong CSP defaults.
