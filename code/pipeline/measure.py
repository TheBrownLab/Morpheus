"""
pipeline/measure.py — cell segmentation measurement helpers.

Provides measure_cells() and compute_feret(), extracted from
measure_training_set.py for reuse by the web backend.
"""
from __future__ import annotations

import math

import numpy as np
from skimage import measure, segmentation

from .image_io import normalise_uint8  # re-export for convenience

__all__ = ["measure_cells", "compute_feret", "normalise_uint8"]


# ── Feret diameter ────────────────────────────────────────────────────────────

def compute_feret(props) -> dict:
    """Compute max/min Feret diameters with the angles needed to draw them.

    Returns dict with keys:
        max_px, min_px, max_angle_rad, min_angle_rad

    Angles are in (row, col) projection space:
        projection = row * cos(a) + col * sin(a)
    """
    coords = np.argwhere(props.image_convex)
    if len(coords) < 3:
        d = float(props.feret_diameter_max)
        return {
            "max_px": d,
            "min_px": d,
            "max_angle_rad": 0.0,
            "min_angle_rad": math.pi / 2,
        }

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

def measure_cells(
    mask: np.ndarray,
    pixel_size_um: float,
    min_area_px: int,
    max_area_px: int,
) -> tuple[list[dict], list, np.ndarray]:
    """Filter and measure labelled regions after clearing border cells.

    Parameters
    ----------
    mask : int32 label array (0 = background)
    pixel_size_um : µm per pixel
    min_area_px : minimum cell area in pixels (inclusive)
    max_area_px : maximum cell area in pixels (inclusive)

    Returns
    -------
    rows : list of measurement dicts (one per cell)
    props_list : list of skimage RegionProperties objects (same order as rows)
    mask_clean : border-cleared mask
    """
    mask_clean = segmentation.clear_border(mask)
    rows: list[dict] = []
    props_list = []

    for p in measure.regionprops(mask_clean):
        if not (min_area_px <= p.area <= max_area_px):
            continue
        if p.minor_axis_length < 1:
            continue

        feret = compute_feret(p)
        feret_ar = (
            round(feret["max_px"] / feret["min_px"], 4)
            if feret["min_px"] > 0
            else None
        )

        rows.append({
            "cell_id":             p.label,
            # Ellipse-based
            "length_um":           round(p.major_axis_length * pixel_size_um, 3),
            "breadth_um":          round(p.minor_axis_length * pixel_size_um, 3),
            "aspect_ratio":        round(p.major_axis_length / p.minor_axis_length, 4),
            # Feret
            "feret_max_um":        round(feret["max_px"] * pixel_size_um, 3),
            "feret_min_um":        round(feret["min_px"] * pixel_size_um, 3),
            "feret_aspect_ratio":  feret_ar,
            "feret_max_angle_rad": round(feret["max_angle_rad"], 4),
            "feret_min_angle_rad": round(feret["min_angle_rad"], 4),
            # Shape descriptors
            "area_um2":            round(p.area * pixel_size_um ** 2, 3),
            "area_px":             p.area,
            "solidity":            round(p.solidity, 4),
            "perimeter_um":        round(p.perimeter * pixel_size_um, 3),
            "centroid_y_px":       round(p.centroid[0], 1),
            "centroid_x_px":       round(p.centroid[1], 1),
            "orientation_rad":     round(p.orientation, 4),
            "bbox":                list(p.bbox),
        })
        props_list.append(p)

    return rows, props_list, mask_clean
