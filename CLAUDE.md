# CLAUDE.md — Morpheus Development Context

This file provides guidance to Claude Code when working in this repository.

## Environment

Run with the `morpheus` conda environment:

```bash
conda activate morpheus
cd /Users/tristamoeba/Projects/Morpheus/code
uvicorn app:app --reload --port 8000
```

**Install (reproducible):** `conda env create -f environment.lock.yml`  
**Install (dev/flexible):** `conda env create -f environment.yml`  
**Update lock file after changing environment.yml:** `conda env export -n morpheus --no-builds > environment.lock.yml`

Python path: `/Users/tristamoeba/opt/miniconda3/envs/morpheus/bin/python`  
(Falls back to `napari-env` if `morpheus` env not found — see `get_pipeline_python()` in `app.py`.)

**Run tests** before committing changes to `app.py`:
```bash
cd /Users/tristamoeba/Projects/Morpheus/code
/Users/tristamoeba/opt/miniconda3/envs/morpheus/bin/python -m pytest ../tests/ -q
```

**macOS Qt fix** — required when launching napari from a subprocess:
```bash
export KMP_DUPLICATE_LIB_OK=TRUE
```

Key packages: cellpose 4.x, scikit-image 0.25.x, napari 0.6.x, tifffile, pandas, numpy 2.x, FastAPI, PIL.

---

## Repository layout

```
Morpheus/
├── code/
│   ├── app.py               # FastAPI backend — all API endpoints
│   ├── models/test_model    # pre-trained Cellpose model (Git LFS)
│   ├── pipeline/            # measurement plugin system
│   │   ├── image_io.py      # read_image(), normalise_uint8()
│   │   ├── measure.py       # measure_cells(), compute_feret()
│   │   └── measurements/    # @register decorator + morphology.py plugins
│   ├── scripts/
│   │   ├── measure_training_set.py   # main CLI measurement script
│   │   ├── prepare_training.py       # flatten mask pairs for Cellpose training
│   │   ├── select_images.py          # napari image selector
│   │   ├── copy_selected.py          # copies selections to dest dir
│   │   └── split_frames.py           # split multi-frame OME-TIFFs
│   └── static/
│       ├── index.html        # 6-tab SPA shell
│       ├── app.js            # all frontend logic (~2500 lines, vanilla JS)
│       └── style.css         # CSS custom properties, no framework
├── data/
│   ├── input/<strain>/       # imported raw images
│   └── curated/<analysis_id>/<strain>/   # selected images + _seg.npy masks
├── results/<analysis_id>/
│   ├── measurements.json     # segmentation + measurement data
│   ├── all_cells_premeasured.csv
│   ├── curated_cells.csv     # after export
│   └── <strain>/             # per-cell crop PNGs (grayscale, raw PIL)
├── config.json               # strains + analyses (paths relative to repo root)
├── curation_state.json       # per-cell accept/reject/morphotype state
└── environment.yml           # conda env spec (name: morpheus)
```

Runtime state files (`config.json`, `curation_state.json`, `selections_*.json`) are in `.gitignore` — every developer has their own. The test dataset uses pre-committed versions of these files.

---

## Path resolution (portable repo)

All paths stored in JSON files are **relative to the repo root** for portability. `app.py` resolves them at load time:

- **`_resolve_path(p)`** — makes relative paths absolute using `REPO_DIR`. Used in `_load_measurements()` for `filepath`, `seg_path`, `crop_path`, `feret_crop_path`.
- **`_resolve_model_path(p)`** — bare model names (e.g. `"test_model"`) resolve to `MODELS_DIR/<name>`. Full absolute paths pass through unchanged.
- **`_resolve_dir(p)`** — resolves relative `source_dir` values in strain config.

`REPO_DIR = CODE_DIR.parent` where `CODE_DIR = Path(__file__).parent`.

When saving new measurements, the script writes absolute paths. When the repo is cloned elsewhere, paths won't exist and `_resolve_path` handles the relative→absolute conversion transparently.

---

## Key constants (app.py)

```python
CODE_DIR    = Path(__file__).parent          # .../Morpheus/code/
REPO_DIR    = CODE_DIR.parent                # .../Morpheus/
MODELS_DIR  = CODE_DIR / "models"
DATA_DIR    = REPO_DIR / "data"
INPUT_DIR   = DATA_DIR / "input"
CURATED_DIR = DATA_DIR / "curated"
RESULTS_DIR = REPO_DIR / "results"
CONFIG_FILE         = REPO_DIR / "config.json"
CURATION_STATE_FILE = REPO_DIR / "curation_state.json"
```

---

## Data formats

### `config.json`
```json
{
  "strains": [{"name": "Nolandella", "source_dir": "data/input/Nolandella", "color": "#4ade80"}],
  "analyses": [{
    "id": "nolandella_test",
    "name": "Nolandella Test",
    "model_path": "test_model",
    "measurements": ["length_um", "breadth_um", ...],
    "min_area": 300, "max_area": 500000, "diameter": null,
    "pixel_size_um": 0.1075, "pixels_per_um": null, "strain_models": {}
  }],
  "objectives": [{"name": "60x Oil", "pixel_size_um": 0.1075, "pixels_per_um": 9.3}]
}
```
Model path is stored as bare name; resolved to `MODELS_DIR/<name>` at runtime.

### `measurements.json` (per analysis, in `results/<analysis_id>/`)
Versioned wrapper object (`schema_version: 1`) containing a list of image dicts.
Legacy files written before schema versioning are bare lists — `_load_measurements()` in `app.py` handles both and logs a warning for the legacy format.
```json
{
  "schema_version": 1,
  "images": [{
  "strain": "Nolandella",
  "filename": "image.ome.tif",
  "filepath": "data/curated/nolandella_test/Nolandella/image.ome.tif",
  "seg_path": "data/curated/nolandella_test/Nolandella/image.ome_seg.npy",
  "pixel_size_um": 0.1075,
  "cells": [{
    "cell_id": 1,
    "length_um": 26.1, "breadth_um": 10.2, "aspect_ratio": 2.57,
    "feret_max_um": 25.8, "feret_min_um": 10.3,
    "feret_max_angle_rad": 1.012, "feret_min_angle_rad": 2.72,
    "feret_aspect_ratio": 2.51,
    "area_um2": 200.1, "area_px": 17313, "solidity": 0.94, "perimeter_um": 64.4,
    "centroid_y_px": 803.1, "centroid_x_px": 280.1,
    "orientation_rad": 1.11,
    "bbox": [731, 178, 884, 390],
    "crop_path": "results/nolandella_test/Nolandella/image_cell001.png",
    "feret_crop_path": "results/nolandella_test/Nolandella/image_cell001.png",
    "pixel_size_um": 0.1075
  }]
  }]
}
```

`bbox` is `[min_row, min_col, max_row, max_col]` (skimage convention, row-first).  
`centroid_y_px` = row, `centroid_x_px` = col (also skimage convention).  
`feret_crop_path` now points to the same file as `crop_path` — lines are drawn in the browser.

### `_seg.npy` mask files
```python
data = np.load(seg_path, allow_pickle=True).item()
masks = data["masks"]  # 2D int array, 0=background, 1..N=cell labels
```

### `curation_state.json`
```json
{"nolandella_test::image.ome.tif::1": true}
```
Key format: `"<analysis_id>::<filename>::<cell_id>"`.  
Values: `true` (accepted), `false` (rejected), or a morphotype ID string (e.g. `"elongated"`).

---

## Image I/O

`read_image(path, pixel_size_override)` in `scripts/measure_training_set.py`:
- OME-TIFF: reads with `tifffile`, parses `PhysicalSizeX` from OME XML namespace `http://www.openmicroscopy.org/Schemas/OME/2016-06`
- JPEG/PNG: reads with `skimage.io`, converts RGB→grayscale with `rgb2gray` × 65535
- Returns `(img_float32_2d, pixel_size_um)`
- Default pixel size: `0.1075 µm/px` (60× oil, Hamamatsu ORCA-ERA)

**Browser TIFF serving**: `GET /api/curation/file?path=...` — if `.tif`/`.tiff`, converts to 8-bit normalised PNG in memory (using `tifffile` + `PIL`) before responding. Browsers cannot render TIFF natively.

---

## Segmentation

- Cellpose 4.x: `CellposeModel(gpu=..., pretrained_model=str(path))`
- `model.eval()` returns `(masks, flows, styles)` — note: no `channels` kwarg in 4.x (deprecated)
- Images contrast-stretched to uint8 (1–99th percentile) before Cellpose
- Border-touching masks removed with `skimage.segmentation.clear_border`
- Training CLI flags for 4.x: `--model_name_out <name>`, `--mask_filter _seg.npy`, `--min_train_masks 1`
- After training, model auto-moved from `data/training_masks/models/<name>` to `code/models/`

---

## Cell crop images

Crops are saved as **plain grayscale uint8 PNGs** using PIL — no matplotlib, no baked-in lines:

```python
def save_cell_crop(img, props, out_path, padding=40):
    minr, minc, maxr, maxc = props.bbox
    r0, c0 = max(0, minr-40), max(0, minc-40)
    r1, c1 = min(img.shape[0], maxr+40), min(img.shape[1], maxc+40)
    crop = img[r0:r1, c0:c1].astype(np.float32)
    lo, hi = np.percentile(crop, [1, 99])
    crop8 = ((np.clip(crop, lo, hi) - lo) / (hi-lo+1e-6) * 255).astype(np.uint8)
    PIL.Image.fromarray(crop8, mode="L").save(str(out_path))
```

**Critical**: the PNG pixel at `(col-c0, row-r0)` maps exactly to `(col, row)` in the source image. The JS overlay uses this:
```javascript
const r0 = Math.max(0, cell.bbox[0] - 40);
const c0 = Math.max(0, cell.bbox[1] - 40);
const cx = cell.centroid_x_px - c0;   // canvas x = col
const cy = cell.centroid_y_px - r0;   // canvas y = row
```

Old crops saved with matplotlib had axes/legend padding that broke this mapping. Use **Regen Crops** button in Curate toolbar to fix existing analyses without re-running Cellpose.

---

## Angle / coordinate conventions

**skimage `orientation`** is angle from the **row axis** (not the x-axis). In canvas coordinates (x=col, y=row):
```javascript
// Correct: dx = sin(θ), dy = cos(θ)
// WRONG: dx = cos(θ), dy = sin(θ)  ← this is the standard math convention, not skimage
const ux = Math.sin(angle), uy = Math.cos(angle);
```
This matches `matplotlib.pyplot` which uses `(cx ± sin(θ)*half, cy ± cos(θ)*half)`.

Same convention applies to Feret angles (`feret_max_angle_rad`, `feret_min_angle_rad`).

---

## Frontend architecture (app.js)

Single-page app, vanilla JS, no framework. Six tabs: Setup, Select Images, Train Model, Measure, Curate, Results.

### Key globals
```javascript
const curateState = {
  analysisId, strain, cells, morphotypes, selected,  // Set of "filename:cell_id"
  activeMorph, morphFilter,   // filter grid to one morphotype
  viewMode,          // "grid" | "image"
  overlaysVisible,   // toggle on/off
  overlayType,       // "ellipse" | "feret"
  imageIdx, imageList  // for image view navigation
};
let _imageViewImg, _imageViewMaskImg, _imageViewImgData, _imageViewFullIdx;
let _cropCacheBust;  // "&_v=<timestamp>" appended after regen-crops
const _charts = {};  // Chart.js instance cache (destroy before recreate)
```

### Canvas rendering (Curate tab)
- **Grid view**: each cell is a `<canvas>` (no `<img>`). `redrawCellCanvas(cvs)` draws source PNG via `ctx.drawImage(img, 0, 0)` then overlays.
- **Image view**: single `<canvas id="image-view-canvas">`. `redrawImageViewCanvas()` draws: source → mask overlay → measurement lines.
- Both use `redrawAllOverlays()` for consistent redraw (toggle, type change, etc.).

### Destructive action confirmation
All `confirm()` calls replaced with `confirmBtn(btn, label, timeoutMs)` — two-stage inline button (click once → goes red with "Confirm?" label, click again → executes). Reason: browser "prevent dialogs" setting silently returns `false` for `confirm()`.

### SSE streaming (progress)
`EventSource` for long jobs (measure, train, env install). Server sends `data: <line>\n\n`. Lines containing `[X/Y]` update progress bars. Lines matching `_SUPPRESS` tuple (deprecation warnings) are silently dropped.

### Chart.js
Version 4.4.3 via CDN. Always call `_charts[id].destroy()` before recreating. Per-strain jitter for dot plots, mean-line datasets injected separately.

---

## Measurement plugin system (pipeline/measurements/)

`@register(name, unit, description, requires_feret)` decorator in `pipeline/measurements/__init__.py`. All functions in `morphology.py` are auto-discovered by `GET /api/measurements/available`. Signature:
```python
def my_measure(props, pixel_size_um: float, feret_data: dict | None) -> float:
```
`feret_data` has keys: `max_px`, `min_px`, `max_angle_rad`, `min_angle_rad`.

---

## Cellpose 4.x compatibility notes

- `channels` kwarg deprecated → omit or use positional
- `--model_dir` flag removed → use `--model_name_out <name>` instead
- Default `--mask_filter` changed from `_seg.npy` to `_masks` → always pass `--mask_filter _seg.npy`
- Minimum train masks: `--min_train_masks 1` (default 5 causes ZeroDivisionError on small sets)
- `model.eval()` returns 3-tuple `(masks, flows, styles)` not 4-tuple

## napari 0.6.x compatibility notes

- `add_points()`: use `border_color` not `edge_color`
- Text labels: `properties={"key": [...]}` + `text={"string": "{key}", ...}`
- Labels layer color: `labels_layer.color = {cell_id: "lime"}` on every toggle

## numpy 2.x notes

- `np.ptp()` is correct (`.ptp()` method was removed in NumPy 2.0)
- No `np.bool`, `np.int`, `np.float` aliases

---

## Pending / known issues

1. **Grid mask overlay**: masks are shown in image view only. Grid view shows measurement lines on crops but not the segmentation mask fill. Adding per-cell mask crops would require either a server-side endpoint (load seg.npy, crop to cell bbox, return RGBA PNG) or storing contour coordinates in measurements.json. N API calls for N cells in a large grid would be slow — consider batching or WebSocket.

2. **Existing matplotlib crops**: if an analysis was measured before the PIL crop change, the old crops have baked-in matplotlib lines. Use `POST /api/analyses/{analysis_id}/regen-crops` to fix. Button is in Curate toolbar ("Regen Crops").

3. **Feret lines in image view use centroid**: Feret diameters are not guaranteed to pass through the centroid — they're convex hull projections. Currently drawn through centroid as an approximation. Accurate drawing would require storing the actual caliper endpoints (bbox corners of projection) in measurements.json.

4. **napari subprocess on macOS**: `QT_QPA_PLATFORM_PLUGIN_PATH` env var required in some environments. Set in subprocess env: `KMP_DUPLICATE_LIB_OK=TRUE`.

5. **config.json and curation_state.json are gitignored**: they're runtime state. The test dataset ships with committed versions at the repo root, but `.gitignore` excludes them for user development. If you add them back to `.gitignore`, users' config won't be overwritten by git pulls — this is intentional.

---

## Common development tasks

### Add a new API endpoint
Add to `app.py`. Path resolution helpers (`_resolve_path`, `_resolve_model_path`, `_resolve_dir`) are available for any paths read from config or JSON files.

### Add a new measurement
1. Add function with `@register` in `code/pipeline/measurements/morphology.py`
2. It auto-appears in the "Add Analysis" checklist via `GET /api/measurements/available`
3. No other changes needed

### Add a new frontend tab
1. Add `<li>` nav button + `<section data-tab="...">` in `index.html`
2. Add `case "...": onTabLoad()` in the `switchTab()` function in `app.js`

### Change segmentation parameters
`measure_training_set.py` accepts `--diameter`, `--min_area`, `--max_area`. Set via the analysis config in the UI, passed as CLI args by `app.py`.

### Retrain the model
1. Import images → select → prepare training data
2. Launch Cellpose GUI → draw masks → save `_seg.npy` files
3. Run training via Train tab → new model saved to `code/models/`
4. Update analysis to point to new model

---

## User context

- Terse, direct responses — no summaries of what was just done
- Working code over long explanations
- The pipeline is used for amoeba morphometrics research across multiple diverse strains
