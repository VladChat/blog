# VladChat Blog

This repository powers the VladChat automated newsroom. It extends Google’s [Eleventy High Performance Blog](https://www.industrialempathy.com/posts/eleventy-high-performance-blog/) with scheduled content generation, OpenAI-assisted writing, and a GitHub Pages deployment under [`/blog`](https://vladchat.github.io/blog/).

## How the system works

1. **Configuration driven** – JSON files in [`config/`](config/) control which RSS feeds are scanned, how prompts are assembled, and which keywords should be promoted.
2. **Scripted generation** – [`scripts/generate-posts.js`](scripts/generate-posts.js) fetches the latest headlines, pairs them with rotating keywords, calls OpenAI, and saves validated Markdown posts to `src/posts/YYYY/MM/slug/index.md`.
3. **Automated deployment** – [`.github/workflows/auto-blog.yml`](.github/workflows/auto-blog.yml) runs on a schedule defined in `config/settings.json`, commits any new posts, builds Eleventy, and deploys the site to GitHub Pages via the official Pages actions.

## Repository layout

```
config/              Keyword, settings, writer, and prompt configuration
scripts/             Automation utilities (generate-posts.js)
src/                 Posts, pages, and Eleventy templates
.cache/state.json    History of processed GUIDs and keyword usage
.github/workflows/   Continuous delivery pipelines
```

### Key configuration files

| File | Purpose |
| --- | --- |
| [`config/settings.json`](config/settings.json) | Automation mode, cron frequency, OpenAI model, maximum word count, and RSS feeds. |
| [`config/keywords.json`](config/keywords.json) | Ordered list of strategic keywords that the generator rotates through. |
| [`config/writer.json`](config/writer.json) | Tone, editorial priorities, and structural rules for the writing agent. |
| [`config/prompts.json`](config/prompts.json) | Prompt template with `{{NEWS_HEADLINE}}` and `{{KEYWORD}}` placeholders used to build the OpenAI request. |
| [`.cache/state.json`](.cache/state.json) | Automatically updated log of used GUIDs and keyword/date combinations to prevent duplicates. |

## Required repository settings

1. **GitHub Pages** – Settings → Pages → *Build and deployment* → Select **GitHub Actions**.
2. **Workflow permissions** – Settings → Actions → General → Workflow permissions → enable **Read and write permissions**.
3. **Secrets** – Settings → Secrets and variables → Actions → *New repository secret* → `OPENAI_API_KEY`.

## Local development

Install dependencies with Node.js 20, preview planned posts, and run Eleventy locally:

```bash
npm install
npm run generate:dry   # Lists selected headlines, keywords, and slugs without calling OpenAI
OPENAI_API_KEY=... npm run generate
npm run build
npm start              # Starts Eleventy’s dev server at http://localhost:8080/
```

Generated articles appear under `src/posts/<year>/<month>/<slug>/index.md`. The homepage, archives, tags, and RSS feeds update automatically using Eleventy’s collections.

## Automation details

- Headlines are sorted by recency so the “most demanded” items are prioritised.
- Keywords rotate round-robin and are skipped if the same keyword already produced a post today.
- Meta descriptions are normalised to 150–160 characters and include the assigned keyword exactly once.
- The script records every publication in `.cache/state.json` so reruns stay deterministic.
- Dry runs (`--dry-run`) never call the OpenAI API and simply print the plan.

## Adding or editing pages

Static content such as [About](src/about/index.md) and [Sources Policy](src/sources-policy/index.md) lives in `src/` and uses the shared Eleventy layouts. Manual posts can still be written by creating Markdown files that follow the same front matter schema as the generated articles.

## Deployment

The `auto-blog` workflow performs the following steps on each run:

1. Check out the repository.
2. Install dependencies (`npm ci`).
3. Generate posts (`npm run generate`).
4. Commit and push any changes.
5. Build the Eleventy site (`npm run build`).
6. Deploy to GitHub Pages using `configure-pages`, `upload-pages-artifact`, and `deploy-pages`.

The published site is available at **https://vladchat.github.io/blog/** once the workflow completes successfully.
