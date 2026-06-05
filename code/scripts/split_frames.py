#!/usr/bin/env python3
"""
Split multi-frame OME-TIFF timelapses into individual single-frame OME-TIFFs.

For each .ome.tif in the strain directories, creates a subdirectory named after
the file stem and writes one OME-TIFF per frame, preserving physical size
metadata (µm/pixel) and per-frame MicroManager metadata.
"""

import sys
import os
import json
import uuid
from pathlib import Path
import xml.etree.ElementTree as ET
import tifffile
import numpy as np

BASE = Path(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else Path.cwd()
OME_NS = "http://www.openmicroscopy.org/Schemas/OME/2016-06"

ET.register_namespace("", OME_NS)
ET.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")


def build_single_frame_ome_xml(original_xml: str, frame_index: int, out_filename: str) -> str:
    """Return OME XML describing a single frame extracted from a multi-frame stack."""
    root = ET.fromstring(original_xml)
    ns = {"ome": OME_NS}

    pixels = root.find("ome:Image/ome:Pixels", ns)
    if pixels is None:
        raise ValueError("No Pixels element found in OME XML")

    # Set time dimension to 1
    pixels.set("SizeT", "1")

    # Remove all TiffData children and add a single one for this frame
    for td in pixels.findall("ome:TiffData", ns):
        pixels.remove(td)

    td_elem = ET.SubElement(pixels, f"{{{OME_NS}}}TiffData")
    td_elem.set("FirstC", "0")
    td_elem.set("FirstT", "0")
    td_elem.set("FirstZ", "0")
    td_elem.set("IFD", "0")
    td_elem.set("PlaneCount", "1")

    uuid_elem = ET.SubElement(td_elem, f"{{{OME_NS}}}UUID")
    uuid_elem.set("FileName", out_filename)
    uuid_elem.text = f"urn:uuid:{uuid.uuid4()}"

    # Update Plane DeltaT if present (keep only the one for this frame)
    for plane in pixels.findall("ome:Plane", ns):
        t = int(plane.get("TheT", 0))
        if t != frame_index:
            pixels.remove(plane)
        else:
            plane.set("TheT", "0")

    # Update Image name
    image = root.find("ome:Image", ns)
    if image is not None:
        orig_name = image.get("Name", "")
        image.set("Name", f"{orig_name}_T{frame_index:04d}")

    return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' + ET.tostring(
        root, encoding="unicode"
    )


def split_tiff(tif_path: Path, dry_run: bool = False) -> int:
    """Split a multi-frame OME-TIFF into per-frame files. Returns number of frames written."""
    stem = tif_path.name
    # Strip .ome.tif or .tif suffix for the directory name
    if stem.endswith(".ome.tif"):
        dir_stem = stem[: -len(".ome.tif")]
    elif stem.endswith(".tif"):
        dir_stem = stem[: -len(".tif")]
    else:
        dir_stem = stem

    out_dir = tif_path.parent / dir_stem
    if not dry_run:
        out_dir.mkdir(exist_ok=True)

    with tifffile.TiffFile(str(tif_path)) as tif:
        if not tif.is_ome:
            print(f"  WARNING: {tif_path.name} is not an OME-TIFF — skipping")
            return 0

        ome_xml = tif.ome_metadata
        series = tif.series[0]
        n_frames = series.shape[0] if series.axes.startswith("T") else len(tif.pages)

        if dry_run:
            print(f"  [dry-run] Would write {n_frames} frames to {out_dir}/")
            return n_frames

        print(f"  Splitting {n_frames} frames → {out_dir.name}/")

        for t in range(n_frames):
            frame_data = tif.pages[t].asarray()
            out_name = f"{dir_stem}_T{t:04d}.ome.tif"
            out_path = out_dir / out_name

            frame_ome_xml = build_single_frame_ome_xml(ome_xml, t, out_name)

            # Per-frame MicroManager metadata (physical µm/px is in the OME XML)
            extra_tags = []
            page = tif.pages[t]
            mm_tag = page.tags.get("MicroManagerMetadata")
            if mm_tag is not None:
                mm_bytes = json.dumps(mm_tag.value).encode("utf-8")
                extra_tags.append((51123, "B", len(mm_bytes), mm_bytes, True))

            # Pass description as UTF-8 bytes; OME XML contains µ which is non-ASCII
            tifffile.imwrite(
                str(out_path),
                frame_data,
                photometric="minisblack",
                description=frame_ome_xml.encode("utf-8"),
                extratags=extra_tags,
            )

    return n_frames


def main():
    dry_run = "--dry-run" in sys.argv

    strain_dirs = sorted(d for d in BASE.iterdir() if d.is_dir() and not d.name.startswith("."))

    total_files = 0
    total_frames = 0

    for strain_dir in strain_dirs:
        tif_files = sorted(strain_dir.glob("*.ome.tif"))
        if not tif_files:
            continue
        print(f"\n=== {strain_dir.name} ({len(tif_files)} files) ===")
        for tif_path in tif_files:
            # Skip files that are already in a subdirectory (already split)
            if tif_path.parent.parent == BASE:
                # This is directly in the strain dir — process it
                pass
            print(f"  {tif_path.name}")
            n = split_tiff(tif_path, dry_run=dry_run)
            total_files += 1
            total_frames += n

    print(f"\nDone. Processed {total_files} files, {total_frames} frames total.")
    if dry_run:
        print("(dry run — no files written)")


if __name__ == "__main__":
    main()
