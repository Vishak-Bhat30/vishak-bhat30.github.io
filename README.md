# Vishak K Bhat — research website

A single-page academic homepage. It is static HTML, CSS, and JavaScript with no build step and no frameworks. Google Fonts is the only external request; the GitHub star count is an optional extra.

Live at **https://vishak-bhat30.github.io/**

## Layout

```
index.html              all content (intro, news, publications, experience, projects, service & honors)
assets/css/site.css     styles, light/dark themes, explainer marks
assets/js/site.js       theme toggle, nav highlighting, news "show older", BibTeX copy, GitHub stars, experience Gantt
assets/js/viz.js        the animated explainers (one Story per paper/project) + interwhen result charts
assets/img/             profile photo, favicon, organization logos
assets/resume.pdf       CV (linked as assets/resume.pdf?v=2026-10)
experience.html etc.    redirects from the old multi-page site to the matching section
```

## Common edits

- **News:** add an `<li class="news-item">` at the top of `#newsList` in `index.html`. Items with class `older` stay hidden until "Show older news" is clicked. Use `highlight` for a filled dot and `upcoming` for a dashed one.
- **Publications:** copy an `<article class="paper">` block. The explainer is chosen by `data-viz="..."` on the `.viz-frame`. Each value maps to a function in `viz.js` (`interwhen`, `genesis`, `muon`). To add a paper without an explainer, delete the `.viz-frame` div.
- **Experience:** each card is an `<li class="xp">` in `index.html`. The "At a glance" chart is built from the `rows` array in `site.js`. Keep both in sync, and update `NOW` in `site.js` when you refresh the site.
- **CV:** replace `assets/resume.pdf` and bump the `?v=` query on the CV links in `index.html`.

## Explainers

Each explainer is a `Story`: a list of `{ title, text, run }` steps. The Story:

- plays when scrolled into view and pauses off-screen;
- loops;
- can be jumped to with the numbered buttons.

With `prefers-reduced-motion`, it shows the final state without animating. The interwhen result charts use the numbers from Tables 1 and 2 of the paper. Update `dumbbellChart` and `costChart` in `viz.js` if the camera-ready numbers change.

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Publishing

GitHub Pages serves the `main` branch of this repository from the root (`.nojekyll` disables Jekyll). Push to `main` and the site updates within a few minutes.
