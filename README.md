# 3D-Artifact · 线稿立体工坊

**Turn a line drawing or photo into a 3D-printable model — right in your browser.**

Upload an image, and the app converts it to clean black-and-white line art, fixes lines that are too thin or floating, and builds a print-ready model: a free-standing cut-out silhouette or a relief plaque, with an optional stand (one-piece or slot-fit) and text engraved on the base. Everything runs locally in the browser; your images never leave your computer.

**Live demo:** https://tongchen779.github.io/3D-Artifact/

![Screenshot](docs/screenshot.png)

## Features

- **Line art from any image**: automatic or manual threshold, an adaptive mode for photos, crop, invert, speck removal, and an erase/draw brush for touch-ups.
- **Printable lines**: thin strokes are thickened to a minimum width, and floating pieces are bridged to their nearest neighbour (or removed).
- **Smooth, even strokes**: optionally re-draws every line along its centre with a uniform width, while large filled areas stay solid.
- **Two model types**: cut-out silhouette or relief plaque (two-colour ready: change filament at the plate height).
- **Stand**: none, one-piece, or a separate base with a slot (adjustable depth, height, overhang, insert depth and clearance).
- **Engraving**: text on the front and back of the base, in handwriting, serif or sans fonts, or upload your own `.ttf`/`.otf` (e.g. for Chinese text).
- **Export**: watertight binary STL files, the line art PNG, a rendered preview and print notes, individually or as one ZIP.

## Use it locally

The page loads WebAssembly and font files, so it has to be served over HTTP (opening `index.html` directly from disk will not work):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

Push this folder to the repository, then go to **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. The site appears at `https://<user>.github.io/<repo>/` after a minute or two. No build step is needed.

## Project structure

```
index.html            page markup
css/style.css         styles (light and dark theme)
js/raster.js          distance transform, morphology, labelling, thinning
js/lineart.js         binarise → clean → connect → smooth pipeline
js/models.js          contours → Manifold geometry, text, STL and ZIP export
js/app.js             UI, pipeline orchestration, 3D viewer
vendor/               three.js r128, d3 7.8.5, opentype.js 1.3.4, manifold-3d 3.5.1
fonts/                Dancing Script Bold, DejaVu Serif Bold, Inter SemiBold (Latin subsets)
```

## Credits and licences

The app code is released under the MIT licence (see `LICENSE`). Bundled libraries keep their own licences, included next to each file: [Manifold](https://github.com/elalish/manifold) (Apache-2.0), [three.js](https://threejs.org) (MIT), [d3](https://d3js.org) (ISC) and [opentype.js](https://opentype.js.org) (MIT). Fonts: Dancing Script and Inter (SIL Open Font License 1.1, `fonts/OFL-1.1.txt`) and DejaVu Serif (`fonts/DejaVu-LICENSE.txt`).
