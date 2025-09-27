---
layout: layouts/base.njk
title: Sources & Attribution Policy
templateClass: tmpl-post
eleventyNavigation:
  key: Sources Policy
  order: 4
permalink: /sources-policy/
---

Our automated newsroom prioritizes accuracy, transparency, and respect for original reporting. Each article published on this site is generated from reputable RSS feeds supplied in the project configuration. We never scrape paywalled pages or unpublished material.

## How we select sources

We aggregate headlines from trusted feeds that editors configure in [`config/news.config.json`](https://github.com/). Stories older than the configured time horizon are ignored, and duplicate GUIDs are skipped so that we never republish the same headline twice.

## Summaries in our own words

Artificial intelligence assists with the first draft, but every post is rewritten in our own words. The model receives only the headline, summary, link, and publisher information from the feed to prevent hallucinations or fabricated details.

## Linking and attribution

Every article includes a `sources` list in its front matter. These entries credit the originating publication, link back to the original reporting, and include the publication timestamp when available. This metadata powers the Sources section rendered on each post template.

## Correcting mistakes

If you spot an error or would like us to stop referencing your publication, please open an issue or contact the repository maintainers. We will remove or revise affected posts in the next scheduled run.
