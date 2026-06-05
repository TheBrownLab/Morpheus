#!/usr/bin/env python3
"""
Collect image + _seg.npy mask pairs from a training directory and copy them
into a flat output folder ready for Cellpose training.

Usage:
    python prepare_training.py
    python prepare_training.py --strains Kaksola,Mossii
    python prepare_training.py --src-dir /path/to/training --out-dir /path/to/masks
    python prepare_training.py --dry-run
"""
import argparse
import shutil
from pathlib import Path

IMAGE_EXTS = {".tif", ".tiff", ".jpg", ".jpeg", ".png"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src-dir",  default=None,
                        help="Root training directory containing per-strain subdirs")
    parser.add_argument("--out-dir",  default=None,
                        help="Output flat directory for Cellpose training")
    parser.add_argument("--strains",  default=None,
                        help="Comma-separated list of strains to include (default: all)")
    parser.add_argument("--dry-run",  action="store_true",
                        help="Preview without copying")
    args = parser.parse_args()

    # Resolve paths — defaults to the old morphometrics layout when run standalone
    root = Path(__file__).parent.parent.parent  # repo root when in code/scripts/
    default_src = root / "data" / "training"
    if not default_src.exists():
        default_src = Path(__file__).parent / "training set"  # legacy fallback

    src_dir = Path(args.src_dir) if args.src_dir else default_src
    out_dir = Path(args.out_dir) if args.out_dir else src_dir.parent / "training_masks"

    strain_filter = {s.strip() for s in args.strains.split(",")} if args.strains else None

    if not src_dir.exists():
        print(f"Training directory not found: {src_dir}")
        print("Copy images to the training set first (Select Images tab).")
        return

    pairs = []
    for strain_dir in sorted(src_dir.iterdir()):
        if not strain_dir.is_dir() or strain_dir.name.startswith("."):
            continue
        if strain_filter and strain_dir.name not in strain_filter:
            continue
        for img_file in sorted(strain_dir.rglob("*")):
            if img_file.suffix.lower() not in IMAGE_EXTS:
                continue
            seg = img_file.parent / (img_file.stem + "_seg.npy")
            if seg.exists():
                pairs.append((img_file, seg, strain_dir.name))

    # Deduplicate by image path
    seen = set()
    pairs = [p for p in pairs if not (str(p[0]) in seen or seen.add(str(p[0])))]

    if not pairs:
        print(f"No masked image pairs found in {src_dir}.")
        print("  Need: <image> + <image_stem>_seg.npy in the same folder.")
        print("  Draw masks in Cellpose GUI and save (Ctrl+S) to create _seg.npy files.")
        return

    print(f"Found {len(pairs)} masked pairs from {len({p[2] for p in pairs})} strain(s):\n")
    for img, seg, strain in pairs:
        print(f"  [{strain}]  {img.name}")

    if args.dry_run:
        print(f"\nDry run — nothing copied.")
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    for img, seg, strain in pairs:
        # Lowercase extension so Cellpose's get_image_files() recognises it
        ext_lower = img.suffix.lower()
        dest_img = out_dir / f"{strain}_{img.stem}{ext_lower}"
        dest_seg = out_dir / f"{strain}_{img.stem}_seg.npy"
        shutil.copy2(img, dest_img)
        shutil.copy2(seg, dest_seg)

    print(f"\nCopied {len(pairs)} pairs → {out_dir}")
    print(f"\nNext: train in Cellpose GUI or CLI:")
    print(f"  python -m cellpose --train --dir '{out_dir}' \\")
    print(f"      --pretrained_model cyto2 --n_epochs 200")


if __name__ == "__main__":
    main()
