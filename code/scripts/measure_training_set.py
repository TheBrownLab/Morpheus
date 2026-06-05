#!/usr/bin/env python3
"""
For each image in a curated set directory (or legacy 'training set/<Strain>/'):
  - Loads existing _seg.npy masks if present, otherwise runs the trained Cellpose model
  - Saves _seg.npy alongside unmasked images after segmentation
  - Measures each cell with both ellipse axes (length/breadth) and Feret diameters
  - Saves per-cell crop PNGs with length/breadth axis lines to output directory
  - Writes measurements.json and all_cells_premeasured.csv

Usage:
    python measure_training_set.py --model /path/to/model
    python measure_training_set.py --model /path/to/model --dir /data/curated/cells --outdir /results/cells
    python measure_training_set.py --model /path/to/model --diameter 200 --min_area 3000
"""
import argparse
import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import tifffile
from skimage import measure, segmentation

ROOT = Path(__file__).parent
# Legacy defaults (only used when --dir / --outdir are not supplied)
TRAINING_SET = ROOT.parent.parent / "data" / "curated" / "default"
OUTPUT_DIR = ROOT.parent.parent / "results" / "default"
FERET_DIR = OUTPUT_DIR / "feret"

DEFAULT_PIXEL_SIZE_UM = 0.1075
DEFAULT_MIN_AREA_PX = 300
DEFAULT_MAX_AREA_PX = 500_000


# ── Image I/O ─────────────────────────────────────────────────────────────────

def read_image(path, pixel_size_override=None):
    """Read any supported image format (OME-TIFF, TIFF, JPEG, PNG).

    Returns (image_2d_float32, pixel_size_um).
    pixel_size_override takes precedence over OME metadata.
    """
    path = Path(path)
    ext = path.suffix.lower()

    if ext in (".jpg", ".jpeg", ".png"):
        from skimage import io as skio
        img = skio.imread(str(path))
        if img.ndim == 3:
            from skimage.color import rgb2gray
            img = (rgb2gray(img[..., :3]) * 65535).astype(np.float32)
        pixel_size = pixel_size_override or DEFAULT_PIXEL_SIZE_UM
        if pixel_size_override is None:
            print(f"  ! No pixel size for {path.name} — using default {DEFAULT_PIXEL_SIZE_UM} µm/px. "
                  f"Pass --pixel_size or --pixels_per_um to override.")
        return img.astype(np.float32), pixel_size

    # TIFF / OME-TIFF
    with tifffile.TiffFile(str(path)) as tif:
        img = tif.asarray()
        pixel_size = pixel_size_override or DEFAULT_PIXEL_SIZE_UM
        if pixel_size_override is None and tif.ome_metadata:
            import xml.etree.ElementTree as ET
            root_el = ET.fromstring(tif.ome_metadata)
            ns = {"ome": "http://www.openmicroscopy.org/Schemas/OME/2016-06"}
            pixels = root_el.find(".//ome:Pixels", ns)
            if pixels is not None:
                try:
                    pixel_size = float(pixels.attrib.get("PhysicalSizeX", DEFAULT_PIXEL_SIZE_UM))
                except ValueError:
                    pass
    if img.ndim == 3:
        img = img[0] if img.shape[0] <= 4 else img[..., 0]
    if img.ndim != 2:
        raise ValueError(f"Cannot reduce to 2D: shape={img.shape}")
    return img.astype(np.float32), pixel_size


def normalise_uint8(img):
    lo, hi = np.percentile(img, [1, 99])
    return ((np.clip(img, lo, hi) - lo) / (hi - lo + 1e-6) * 255).astype(np.uint8)


# ── Segmentation & masks ───────────────────────────────────────────────────────

def load_masks(seg_path):
    data = np.load(str(seg_path), allow_pickle=True).item()
    return data["masks"].astype(np.int32)


def save_seg(seg_path, img_u8, masks):
    n = int(masks.max())
    np.save(str(seg_path), {
        "img":      img_u8,
        "masks":    masks,
        "flows":    [],
        "ismanual": np.zeros(n, dtype=bool),
        "filename": str(seg_path).replace("_seg.npy", ""),
    })


def run_cellpose(img_u8, model, diameter, use_gpu):
    masks, _, _ = model.eval(
        img_u8, diameter=diameter, channels=[0, 0],
        flow_threshold=0.4, cellprob_threshold=0.0, do_3D=False,
    )
    return masks.astype(np.int32)


# ── Feret diameter ────────────────────────────────────────────────────────────

def compute_feret(props):
    """Compute max/min Feret diameters with the angles needed to draw them.

    Returns dict with max_px, min_px, max_angle_rad, min_angle_rad.
    Angles are in (row, col) projection space: projection = row*cos(a) + col*sin(a).
    """
    coords = np.argwhere(props.image_convex)
    if len(coords) < 3:
        d = float(props.feret_diameter_max)
        return {"max_px": d, "min_px": d, "max_angle_rad": 0.0, "min_angle_rad": math.pi / 2}

    angles = np.linspace(0, math.pi, 180, endpoint=False)
    widths = np.array([
        float(np.ptp(coords[:, 0] * math.cos(a) + coords[:, 1] * math.sin(a)))
        for a in angles
    ])
    max_i = int(np.argmax(widths))
    min_i = int(np.argmin(widths))
    return {
        "max_px":        widths[max_i],
        "min_px":        widths[min_i],
        "max_angle_rad": float(angles[max_i]),
        "min_angle_rad": float(angles[min_i]),
    }


# ── Measurement ───────────────────────────────────────────────────────────────

def measure_cells(mask, pixel_size_um, min_area_px, max_area_px):
    mask_clean = segmentation.clear_border(mask)
    rows, props_list = [], []
    for p in measure.regionprops(mask_clean):
        if not (min_area_px <= p.area <= max_area_px):
            continue
        if p.minor_axis_length < 1:
            continue

        feret = compute_feret(p)
        feret_ar = round(feret["max_px"] / feret["min_px"], 4) if feret["min_px"] > 0 else None

        rows.append({
            "cell_id":              p.label,
            # Ellipse-based measurements
            "length_um":            round(p.major_axis_length * pixel_size_um, 3),
            "breadth_um":           round(p.minor_axis_length * pixel_size_um, 3),
            "aspect_ratio":         round(p.major_axis_length / p.minor_axis_length, 4),
            # Feret measurements
            "feret_max_um":         round(feret["max_px"] * pixel_size_um, 3),
            "feret_min_um":         round(feret["min_px"] * pixel_size_um, 3),
            "feret_aspect_ratio":   feret_ar,
            "feret_max_angle_rad":  round(feret["max_angle_rad"], 4),
            "feret_min_angle_rad":  round(feret["min_angle_rad"], 4),
            # Shape descriptors
            "area_um2":             round(p.area * pixel_size_um ** 2, 3),
            "area_px":              p.area,
            "solidity":             round(p.solidity, 4),
            "perimeter_um":         round(p.perimeter * pixel_size_um, 3),
            "centroid_y_px":        round(p.centroid[0], 1),
            "centroid_x_px":        round(p.centroid[1], 1),
            "orientation_rad":      round(p.orientation, 4),
            "bbox":                 list(p.bbox),
        })
        props_list.append(p)
    return rows, props_list, mask_clean


# ── Per-cell crop images ───────────────────────────────────────────────────────

def save_cell_crop(img, props, out_path, padding=40):
    """Save a plain normalised-uint8 PNG crop. All measurement lines are drawn by the browser."""
    from PIL import Image as PILImage
    minr, minc, maxr, maxc = props.bbox
    r0 = max(0, minr - padding)
    c0 = max(0, minc - padding)
    r1 = min(img.shape[0], maxr + padding)
    c1 = min(img.shape[1], maxc + padding)
    crop = img[r0:r1, c0:c1].astype(np.float32)
    lo, hi = np.percentile(crop, [1, 99])
    crop8 = ((np.clip(crop, lo, hi) - lo) / (hi - lo + 1e-6) * 255).astype(np.uint8)
    PILImage.fromarray(crop8, mode="L").save(str(out_path))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model",         required=True, help="Path to trained Cellpose model")
    parser.add_argument("--dir",           default=None,
                        help="Root directory containing <strain>/<images> subdirectories. "
                             "Overrides built-in TRAINING_SET path.")
    parser.add_argument("--outdir",        default=None,
                        help="Output directory for measurements.json and CSVs. "
                             "Overrides built-in OUTPUT_DIR path.")
    parser.add_argument("--diameter",      type=float, default=None)
    parser.add_argument("--min_area",      type=int,   default=DEFAULT_MIN_AREA_PX)
    parser.add_argument("--max_area",      type=int,   default=DEFAULT_MAX_AREA_PX)
    parser.add_argument("--no_gpu",        action="store_true")
    parser.add_argument("--pixel_size",    type=float, default=None,
                        help="Pixel size in µm/px (overrides OME metadata). "
                             "Use for JPEG/PNG images.")
    parser.add_argument("--pixels_per_um", type=float, default=None,
                        help="Pixels per µm (e.g. 9.3). Converted to µm/px automatically. "
                             "Takes precedence over --pixel_size.")
    parser.add_argument("--strain",        default=None,
                        help="Only process this strain subdirectory (e.g. SappSF25.cells).")
    args = parser.parse_args()

    # Resolve directories
    input_root = Path(args.dir) if args.dir else TRAINING_SET
    output_root = Path(args.outdir) if args.outdir else OUTPUT_DIR

    pixel_size_override = None
    if args.pixels_per_um is not None:
        pixel_size_override = 1.0 / args.pixels_per_um
        print(f"Pixel size: {args.pixels_per_um} px/µm → {pixel_size_override:.5f} µm/px")
    elif args.pixel_size is not None:
        pixel_size_override = args.pixel_size
        print(f"Pixel size override: {pixel_size_override} µm/px")

    model_path = Path(args.model)
    if not model_path.exists():
        print(f"Model not found: {model_path}")
        sys.exit(1)

    if not input_root.exists():
        print(f"Input directory not found: {input_root}")
        sys.exit(1)

    images = []
    for strain_dir in sorted(input_root.iterdir()):
        if not strain_dir.is_dir() or strain_dir.name.startswith("."):
            continue
        if args.strain and strain_dir.name != args.strain:
            continue
        for f in sorted(strain_dir.rglob("*")):
            if f.suffix.lower() in {".tif", ".tiff", ".jpg", ".jpeg", ".png"}:
                images.append((strain_dir.name, f))
    seen = set(); images = [(s, f) for s, f in images if not (str(f) in seen or seen.add(str(f)))]

    if not images:
        strain_note = f" (strain={args.strain})" if args.strain else ""
        print(f"No images found in {input_root}{strain_note}")
        sys.exit(1)

    print(f"\nLoading Cellpose model: {model_path.name}")
    from cellpose import models as cp_models
    use_gpu = not args.no_gpu
    model = cp_models.CellposeModel(gpu=use_gpu, pretrained_model=str(model_path))
    print(f"  GPU: {use_gpu}")
    print(f"  {len(images)} images to process\n")
    print(f"  Input:  {input_root}")
    print(f"  Output: {output_root}\n")

    output_root.mkdir(parents=True, exist_ok=True)

    all_image_data = []
    all_flat_rows = []

    for i, (strain, tif_path) in enumerate(images, 1):
        print(f"[{i:>3}/{len(images)}] {strain} | {tif_path.name}", flush=True)

        strain_out = output_root / strain
        strain_out.mkdir(parents=True, exist_ok=True)

        try:
            img, pixel_size = read_image(tif_path, pixel_size_override)
        except Exception as e:
            print(f"  ✗ read error: {e}")
            continue

        img_u8 = normalise_uint8(img)
        seg_path = tif_path.parent / (tif_path.stem + "_seg.npy")

        masks = None
        if seg_path.exists():
            try:
                masks = load_masks(seg_path)
                source = "existing mask"
            except Exception as e:
                print(f"  ! seg load failed ({e}), running Cellpose")

        if masks is None:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    masks = run_cellpose(img_u8, model, args.diameter, use_gpu)
                save_seg(seg_path, img_u8, masks)
                source = "Cellpose"
            except Exception as e:
                print(f"  ✗ Cellpose error: {e}")
                continue

        n_detected = int(masks.max())
        cell_rows, props_list, mask_clean = measure_cells(
            masks, pixel_size, args.min_area, args.max_area
        )
        print(f"  {source}: {n_detected} detected → {len(cell_rows)} measured", flush=True)

        cell_row_pixel_size = pixel_size
        for cell_row, props in zip(cell_rows, props_list):
            crop_name = f"{tif_path.stem}_cell{cell_row['cell_id']:03d}.png"
            crop_path = strain_out / crop_name
            cell_row["pixel_size_um"] = cell_row_pixel_size
            try:
                save_cell_crop(img, props, crop_path)
                cell_row["crop_path"] = str(crop_path)
                cell_row["feret_crop_path"] = str(crop_path)  # same raw PNG; overlays drawn in browser
            except Exception as e:
                print(f"    ! crop error cell {cell_row['cell_id']}: {e}")
                cell_row["crop_path"] = ""
                cell_row["feret_crop_path"] = ""

        image_data = {
            "strain":        strain,
            "filename":      tif_path.name,
            "filepath":      str(tif_path),
            "seg_path":      str(seg_path),
            "pixel_size_um": pixel_size,
            "cells":         cell_rows,
        }
        all_image_data.append(image_data)

        for row in cell_rows:
            all_flat_rows.append({
                "strain":   strain,
                "filename": tif_path.name,
                "filepath": str(tif_path),
                **{k: v for k, v in row.items() if k != "bbox"},
            })

    # Save measurements.json
    json_path = output_root / "measurements.json"
    with open(json_path, "w") as f:
        json.dump(all_image_data, f, indent=2)
    print(f"\nSaved: {json_path}")

    if not all_flat_rows:
        print("\nNo cells measured. Try adjusting --min_area / --max_area.")
        return

    df = pd.DataFrame(all_flat_rows)

    # Main CSV (all columns)
    col_order = [
        "strain", "filename", "cell_id",
        "length_um", "breadth_um", "aspect_ratio",
        "feret_max_um", "feret_min_um", "feret_aspect_ratio",
        "area_um2", "area_px", "solidity", "perimeter_um",
        "centroid_x_px", "centroid_y_px", "orientation_rad",
        "pixel_size_um", "crop_path", "feret_crop_path", "filepath",
    ]
    df = df[[c for c in col_order if c in df.columns]]
    csv_path = output_root / "all_cells_premeasured.csv"
    df.to_csv(csv_path, index=False)
    print(f"Saved: {csv_path}")

    print(f"\n{len(df)} cells across {df['strain'].nunique()} strains")
    print(f"\nNext: python curate_cells.py")


if __name__ == "__main__":
    main()
