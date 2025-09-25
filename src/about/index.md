---
title: "About"
layout: layouts/post.njk
description: "Learn more about the VladChat blog and its mission."
eleventyNavigation:
  key: About
  order: 2
---

## About this publication

VladChat Blog explores the intersection of technology, AI, and business strategy. The site began as an experiment with the Eleventy High Performance Blog starter and has grown into an automated newsroom where editors can blend handcrafted analysis with generated coverage on fast-moving stories.

## How the automation works

We use a scheduled workflow that reviews curated RSS feeds, pairs the most in-demand headlines with a rotating set of strategic keywords, and collaborates with OpenAI's GPT models to produce long-form explainers. Each article is checked into this repository so the entire publishing history remains transparent.

## Keeping humans in the loop

Editors configure the automation with JSON files in the `config/` directory, review generated drafts locally, and can always edit or supplement posts before publishing. The goal is to amplify reporting capacity—not to remove thoughtful editorial oversight.
