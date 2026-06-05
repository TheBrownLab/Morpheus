"""
pipeline/image_io.py — image reading, normalisation, and JPEG helpers.

Supports OME-TIFF, plain TIFF, JPEG, and PNG.
"""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np

DEFAULT_PIXEL_SIZE_UM = 0.1075  # 60x oil, Hamamatsu ORCA-ERA


# ── Core reader ───────────────────────────────────────────────────────────────

def read_image(path: str | Path, pixel_size_override: float | None = None) -> tuple[np.ndarray, float]:
    """Read any supported image format and return (img_float32_2d, pixel_size_um).

    Supports OME-TIFF, plain TIFF, JPEG, PNG.
    pixel_size_override (µm/px) takes precedence over OME XML metadata.
    Default pixel size is 0.1075 µm/px (60x oil objective).
    """
    import tifffile

    path = Path(path)
    ext = path.suffix.lower()

    if ext in (".jpg", ".jpeg", ".png"):
        from skimage import io as skio
        img = skio.imread(str(path))
        if img.ndim == 3:
            from skimage.color import rgb2gray
            img = (rgb2gray(img[..., :3]) * 65535).astype(np.float32)
        pixel_size = pixel_size_override if pixel_size_override is not None else DEFAULT_PIXEL_SIZE_UM
        return img.astype(np.float32), pixel_size

    # TIFF / OME-TIFF
    with tifffile.TiffFile(str(path)) as tif:
        img = tif.asarray()
        pixel_size = pixel_size_override if pixel_size_override is not None else DEFAULT_PIXEL_SIZE_UM
        if pixel_size_override is None and tif.ome_metadata:
            import xml.etree.ElementTree as ET
            try:
                root_el = ET.fromstring(tif.ome_metadata)
                ns = {"ome": "http://www.openmicroscopy.org/Schemas/OME/2016-06"}
                pixels = root_el.find(".//ome:Pixels", ns)
                if pixels is not None:
                    raw = pixels.attrib.get("PhysicalSizeX")
                    if raw:
                        pixel_size = float(raw)
            except Exception:
                pass

    if img.ndim == 3:
        img = img[0] if img.shape[0] <= 4 else img[..., 0]
    if img.ndim != 2:
        raise ValueError(f"Cannot reduce image to 2D: shape={img.shape}")

    return img.astype(np.float32), pixel_size


# ── Normalisation ─────────────────────────────────────────────────────────────

def normalise_uint8(img: np.ndarray) -> np.ndarray:
    """Stretch 1–99th percentile contrast to uint8."""
    lo, hi = np.percentile(img, [1, 99])
    return ((np.clip(img, lo, hi) - lo) / (hi - lo + 1e-6) * 255).astype(np.uint8)


# ── Display JPEG ──────────────────────────────────────────────────────────────

def to_display_jpeg(
    img_float32: np.ndarray,
    quality: int = 85,
    max_long_side: int = 1600,
) -> bytes:
    """Normalise 1–99th percentile and return as JPEG bytes.

    Resizes to max_long_side on the longest dimension for performance.
    """
    from PIL import Image

    u8 = normalise_uint8(img_float32)
    pil_img = Image.fromarray(u8, mode="L")

    # Resize if needed
    w, h = pil_img.size
    longest = max(w, h)
    if longest > max_long_side:
        scale = max_long_side / longest
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        pil_img = pil_img.resize((new_w, new_h), Image.LANCZOS)

    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def make_thumbnail(img_float32: np.ndarray, max_size: int = 200) -> bytes:
    """Return a small JPEG thumbnail (max_size × max_size, preserving aspect ratio)."""
    from PIL import Image

    u8 = normalise_uint8(img_float32)
    pil_img = Image.fromarray(u8, mode="L")
    pil_img.thumbnail((max_size, max_size), Image.LANCZOS)

    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=75)
    return buf.getvalue()
