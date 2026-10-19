# blackball blog — minimal redesign

> Status: approved 2026-10-19; revised the same day after feedback
> Direction: **minimal green terminal, with a tag-cloud homepage**

## Preview

![Minimal homepage](../preview-home.png)

![Minimal article page](../preview-post.png)

## Context

`blackball` is a small personal blog with seven Chinese essays. The original site was a
narrow black-and-green page: a lotus logo, one line of text, and a wrapping list of post
titles. The owner prefers that extreme simplicity. An earlier editorial redesign was
rejected as too much like a magazine homepage.

## Goals

1. Keep the build and publishing improvements: one Markdown file in, static pages out,
   preserved URLs, useful errors, and automatic GitHub Pages deployment.
2. Return the interface to a single narrow column with no visual machinery.
3. Make the homepage work as a uniform inline tag cloud of post titles.
4. Keep long-form reading comfortable, with a quiet serif body and a terminal accent.

## Non-goals

- Hero sections, featured-post cards, status panels, year groupings, or archive pages.
- Theme switching, table of contents, reading progress, copy buttons, back-to-top,
  scroll animations, or any client-side JavaScript.
- Tags, search, comments, analytics, or RSS.
- Rewriting the essays.

## Content model

- Posts live in `posts/` as `YYYY-MM-DD-slug.md`.
- The first line beginning with `## ` is the title; it is removed from the body so it is
  not duplicated.
- The filename supplies the date and the URL. Existing URLs, including
  `02023-08-06-about.html`, are preserved.
- The first paragraph supplies the page description.
- `site.json` owns the title, tagline, description, author, email, GitHub URL, language,
  and start year.

## Build

1. Load and validate `site.json`.
2. Read posts, validate filenames and dates, extract titles and summaries.
3. Render Markdown with the standard `extra` and `sane_lists` extensions. No syntax
   highlighter, no TOC extension.
4. Render pages from `templates/base.html`, `index.html`, `post.html`, and `404.html`
   through a tiny `{{ key }}` renderer.
5. Write `index.html`, one `html/<stem>.html` per post, and `404.html`.
6. Delete only stale generated files that carry the generator marker.
7. Offer `python build.py --serve` for a local preview.

The only dependency is `Markdown`, pinned in `requirements.txt`.

## Pages

- **Home:** lotus logo, tagline, then every post title as a uniform inline link, newest
  first, wrapping naturally like a tag cloud. Footer with copyright, email, and GitHub.
- **Post:** small lotus link home, date, title, prose, one return link. No other navigation.
- **404:** small "404", one sentence, return link.

## Visual system

- **Palette:** charcoal `#1b1b1b`, soft green-grey reading text, original terminal green
  `#00d000`, brighter green for hover/focus, desaturated green for metadata.
- **Layout:** one 620px column centred in the viewport; no grid, cards, shadows, glows,
  gradients, or background texture.
- **Tag cloud:** uniform size, no dates or counts, spacing between links, each title kept
  on one line, natural wrapping between titles.
- **Type:** Chinese body and post titles use Noto Serif SC; the tag cloud, dates, and
  footer use IBM Plex Mono, with local fallbacks.
- **Motion:** none. Hover and focus changes are colour-only.
- **Accessibility:** same-column tab order, skip link, visible focus outline, sufficient
  contrast, responsive down to 320px.

## Publishing

`.github/workflows/publish.yml` builds with Python 3.12, stages only the public static
files, and deploys through GitHub's official Pages actions. One-time repository setup:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

Generated HTML remains committed so the site can also be served from the branch.

## Verification

- Build all existing posts with no warnings.
- Check every internal link, anchor, page title, and preserved URL.
- Verify the page loads with JavaScript disabled and contains no scripts.
- Check desktop and mobile layouts in a real browser at 320, 390, 768, 1024, 1440, and
  1920px, with no horizontal overflow.
- Confirm the tag cloud wraps only between titles and remains readable.
- Check the 404 page and local preview server.
