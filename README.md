# Morpheus — Morphometrics Pipeline

Web-based pipeline for Cellpose segmentation and morphometric measurements of protists from brightfield OME-TIFF or JPEG/PNG images. Try it out with various microscopy datasets.

A **Nolandella** test dataset and pre-trained model are included so you can explore every tab of the pipeline immediately after installation.

---

## Installation

### Prerequisites

You need **Conda** or **Mamba** installed. Mamba resolves environments much faster.

- **Miniforge** (includes mamba, recommended): https://github.com/conda-forge/miniforge
- **Miniconda** (conda only): https://docs.conda.io/en/latest/miniconda.html

### 1. Clone the repository

```bash
git clone https://github.com/TheBrownLab/morpheus.git
cd morpheus
```

> **Note:** The repository uses **Git LFS** for large model files.  
> Make sure Git LFS is installed before cloning: `brew install git-lfs && git lfs install`  
> On Linux: `sudo apt install git-lfs && git lfs install`

### 2. Create the conda environment

Using **mamba** (faster):
```bash
mamba env create -f environment.yml
```

Using **conda**:
```bash
conda env create -f environment.yml
```

This creates an environment named `morpheus` with Python 3.11, Cellpose 4.x, scikit-image, FastAPI, and all other dependencies.

> **Note:** I finding using [claude code](https://code.claude.com/docs/en/quickstart) in the terminal here to be useful if you are having issues. Claude's code interpreter effectively troubleshoots installation and environment issues through iterative error correction, which is particularly useful for resolving conda-related setup problems.

### 3. Activate the environment

```bash
conda activate morpheus
```

### 4. Launch the app

```bash
cd code/
uvicorn app:app --reload --port 8000
```

Open **http://localhost:8000** in your browser.

---

## Test dataset

The repository includes a complete **Nolandella** dataset ready to explore:

| Tab | What's pre-loaded |
|---|---|
| **Setup** | Nolandella strain with 16 imported images |
| **Select Images** | Browse and select images in the built-in full-screen viewer |
| **Measure** | `nolandella_test` analysis with pre-computed measurements |
| **Curate** | Browse 32 segmented cells, toggle overlays, assign morphotypes |
| **Results** | Charts for all measurements |

The included model (`code/models/test_model`) was trained on amoeba DIC images at 60× oil (0.1075 µm/px).

---

## Quick start (returning users)

```bash
conda activate morpheus
cd morpheus/code
uvicorn app:app --reload --port 8000
# Open http://localhost:8000
```

---

## Updating the environment

```bash
mamba env update -f environment.yml --prune
# or:
conda env update -f environment.yml --prune
```

---

## Troubleshooting

**`conda activate` not recognised** — run `conda init <your-shell>` (e.g. `conda init zsh`) and restart your terminal.

**Port 8000 already in use:**
```bash
uvicorn app:app --reload --port 8001
```

---

## Directory layout

```
morpheus/
├── code/
│   ├── app.py                        # FastAPI backend
│   ├── models/
│   │   └── test_model                # included pre-trained model (via Git LFS)
│   ├── scripts/                      # CLI measurement + utility scripts
│   └── static/                       # frontend (index.html, app.js, style.css)
├── data/
│   ├── input/
│   │   └── Nolandella/               # test images (16 OME-TIFFs, via Git LFS)
│   └── curated/
│       └── nolandella_test/
│           └── Nolandella/           # curated test images + segmentation masks
├── results/
│   └── nolandella_test/
│       ├── measurements.json         # pre-computed measurements
│       ├── all_cells_premeasured.csv
│       └── Nolandella/               # per-cell crop PNGs
├── config.json                       # strains + analysis configuration
├── environment.yml                   # conda environment spec
└── README.md
```

---

## Pipeline steps

### 1. Setup
Define strains (name + source image directory) and create analysis types (Cellpose model, measurements to compute, cell size filters, pixel size).

### 2. Select Images
Browse `data/input/` in the built-in full-screen viewer. Images already in the set are pre-checked. Check to add, uncheck to remove — clicking **Done** applies changes immediately. Use the Training Set section to select images for model training.

### 3. Train Model (optional)
Launch the Cellpose GUI on training images, draw masks, then train a custom model. The new model is saved to `code/models/` for use in analyses.

### 4. Measure
Run Cellpose segmentation + regionprops on selected images. Outputs `results/<analysis_id>/measurements.json` and per-cell crop PNGs.

### 5. Curate
Review cells in grid or per-image view. Assign morphotypes, accept/reject cells. Toggle between ellipse-axis and Feret-diameter overlays. Export curated CSV.

### 6. Results -- not working that well TBH
Summary table (mean ± SD per strain and morphotype) with scatter and distribution charts. Download CSV or build a multi-tab Excel file.

---

## Adding a new strain

1. Set up tab → Add Strain → point to your image directory
2. Import → images are copied to `data/input/<strain>/`
3. Select Images → curate into an analysis
4. Measure → runs Cellpose on your images

## Adding measurements

Create a function in `code/pipeline/measurements/morphology.py` and decorate with `@register`:

```python
from . import register

@register("my_measurement", unit="µm", description="What it measures")
def my_measurement(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(props.some_property * pixel_size_um, 3)
```

The measurement appears automatically in the "Add Analysis" checklist.
