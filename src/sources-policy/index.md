---
title: "Sources Policy"
layout: layouts/post.njk
description: "Our approach to citing and validating sources across automated posts."
eleventyNavigation:
  key: Sources Policy
  order: 3
---

## Commitment to verifiable sources

Every generated article includes a dedicated *Sources* section that links directly to the original reporting cited in the automation pipeline. We prioritise authoritative outlets surfaced by the configured RSS feeds and never publish without at least one verifiable reference.

## Automated selection safeguards

The generator tracks previously used headlines to avoid duplicates, rotates through strategic keywords, and records each publication in `.cache/state.json`. These guardrails help ensure variety while keeping an auditable trail of which feeds and keywords informed a story.

## Editorial review and corrections

If a cited source is updated or corrected, editors can regenerate a post, edit the Markdown manually, or add clarifying notes before deploying. Pull requests document every change so the community can follow along.
