"""
pipeline/measurements/morphology.py — built-in morphometric measurements.

All measurements register themselves via @register from __init__.py.
"""
from __future__ import annotations

import math

from . import register


@register("length_um", unit="µm", description="Major axis length of equivalent ellipse")
def length_um(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(props.major_axis_length * pixel_size_um, 3)


@register("breadth_um", unit="µm", description="Minor axis length of equivalent ellipse")
def breadth_um(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(props.minor_axis_length * pixel_size_um, 3)


@register("aspect_ratio", unit="", description="Ratio of major axis to minor axis (length/breadth)")
def aspect_ratio(props, pixel_size_um: float, feret_data: dict | None):
    minor = props.minor_axis_length
    if minor < 1:
        return None
    return round(props.major_axis_length / minor, 4)


@register("area_um2", unit="µm²", description="Cell area in square micrometres")
def area_um2(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(props.area * pixel_size_um ** 2, 3)


@register("area_px", unit="px²", description="Cell area in pixels")
def area_px(props, pixel_size_um: float, feret_data: dict | None) -> int:
    return props.area


@register("perimeter_um", unit="µm", description="Cell perimeter in micrometres")
def perimeter_um(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(props.perimeter * pixel_size_um, 3)


@register("solidity", unit="", description="Ratio of cell area to convex hull area")
def solidity(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(props.solidity, 4)


@register("circularity", unit="", description="4π·area / perimeter² (1 = perfect circle)")
def circularity(props, pixel_size_um: float, feret_data: dict | None):
    if props.perimeter < 1:
        return None
    return round(4 * math.pi * props.area / props.perimeter ** 2, 4)


@register("eccentricity", unit="", description="Eccentricity of equivalent ellipse (0=circle, 1=line)")
def eccentricity(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(props.eccentricity, 4)


@register("orientation_deg", unit="°", description="Orientation of major axis in degrees")
def orientation_deg(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(math.degrees(props.orientation), 2)


@register(
    "feret_max_um",
    unit="µm",
    description="Maximum Feret diameter (caliper width at widest angle)",
    requires_feret=True,
)
def feret_max_um(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(feret_data["max_px"] * pixel_size_um, 3)


@register(
    "feret_min_um",
    unit="µm",
    description="Minimum Feret diameter (caliper width at narrowest angle)",
    requires_feret=True,
)
def feret_min_um(props, pixel_size_um: float, feret_data: dict | None) -> float:
    return round(feret_data["min_px"] * pixel_size_um, 3)


@register(
    "feret_aspect_ratio",
    unit="",
    description="Ratio of maximum to minimum Feret diameter",
    requires_feret=True,
)
def feret_aspect_ratio(props, pixel_size_um: float, feret_data: dict | None):
    max_px = feret_data["max_px"]
    min_px = feret_data["min_px"]
    if min_px < 0.1:
        return None
    return round(max_px / min_px, 4)


# Trigger registration on import (no explicit __all__ needed)
