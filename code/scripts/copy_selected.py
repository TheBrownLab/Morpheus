#!/usr/bin/env python3
"""
Copy images listed in selected_images.json into a target directory.

Usage:
    python copy_selected.py --selections <selected_images.json> \
                            --source-base <root-dir-images-are-relative-to> \
                            --dest <output-dir>

If --selections is omitted, looks for selected_images.json in the current directory.
"""
import argparse
import json
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--selections", default="selected_images.json",
                        help="Path to selected_images.json")
    parser.add_argument("--dest", required=True,
                        help="Destination root (strain subdirs created automatically)")
    parser.add_argument("--source-base", default=None,
                        help="Base directory that image paths are relative to (optional)")
    args = parser.parse_args()

    sel_path = Path(args.selections)
    if not sel_path.exists():
        print(f"Selections file not found: {sel_path}")
        raise SystemExit(1)

    with open(sel_path) as f:
        data = json.load(f)

    dest_root = Path(args.dest)
    base = Path(args.source_base) if args.source_base else None

    counts = {}
    for src_str in data.get("selected", []):
        src = Path(src_str)
        if base and not src.is_absolute():
            src = base / src
        strain = src.parent.name
        dest_dir = dest_root / strain
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest_dir / src.name)
        counts[strain] = counts.get(strain, 0) + 1
        print(f"  {strain}/{src.name}")

    print(f"\nDone. Copied {sum(counts.values())} files:")
    for strain, n in sorted(counts.items()):
        print(f"  {strain}: {n}")


if __name__ == "__main__":
    main()
