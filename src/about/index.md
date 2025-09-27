---
layout: layouts/base.njk
title: About
templateClass: tmpl-post
eleventyNavigation:
  key: About
  order: 3
permalink: /about/
---

AI-SEO Newsroom is a fully automated publication that blends reliable reporting with modern search optimisation. Every day, we gather trusted headlines from curated RSS feeds, pair them with a rotating list of high-value keywords, and ask OpenAI to produce original explainers tailored to technology leaders.

Humans stay in the loop by maintaining the configuration files in this repository. Editors choose feeds, prompts, and model fallbacks, while the GitHub Actions workflow handles article generation, Eleventy builds, and GitHub Pages deployment.

This site extends Google’s [Eleventy High Performance Blog](https://www.industrialempathy.com/posts/eleventy-high-performance-blog/) starter, preserving its speed-focused architecture while adding a responsible automation layer.
