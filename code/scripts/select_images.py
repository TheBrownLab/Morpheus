#!/usr/bin/env python3
"""
Interactive napari viewer for browsing and selecting training images.

Supports OME-TIFF, plain TIFF, JPEG, and PNG. Browse all images under a
directory, mark good ones with Space, and save selections to JSON.
Selected images are then copied to 'training set/' by copy_selected.py.

Usage:
    python select_images.py                     # scan current directory
    python select_images.py /path/to/images     # scan specific directory
    python select_images.py --target 30         # change selection target count

Controls:
    Right / Left arrow  : next / previous image
    Space               : toggle selection
    S                   : save selections to JSON
    J                   : jump to first unviewed image
    F / B               : jump forward / back 10 images
"""

import argparse
import json
import os
import sys
from pathlib import Path

import napari
import numpy as np
from qtpy.QtCore import Qt
from qtpy.QtGui import QFont
from qtpy.QtWidgets import (
    QHBoxLayout, QLabel, QListWidget, QListWidgetItem,
    QPushButton, QProgressBar, QVBoxLayout, QWidget,
)

ROOT = Path(__file__).parent
_env_sel = os.environ.get("SELECTIONS_FILE")
SELECTIONS_FILE = Path(_env_sel) if _env_sel else ROOT / "selected_images.json"

IMAGE_EXTENSIONS = {".ome.tif", ".ome.tiff", ".tif", ".tiff", ".jpg", ".jpeg", ".png"}
SKIP_PATTERNS = {" copy", "_test_split"}


def get_strain(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).parts[0]
    except ValueError:
        return path.parent.name


def get_run(path: Path) -> str:
    return path.parent.name


def collect_files(root: Path) -> list[Path]:
    files = []
    for p in root.rglob("*"):
        if p.suffix.lower() not in {".tif", ".tiff", ".jpg", ".jpeg", ".png"}:
            continue
        if any(skip in str(p) for skip in SKIP_PATTERNS):
            continue
        files.append(p)
    # Deduplicate (*.tif matches inside *.ome.tif globs on some systems)
    seen = set()
    unique = []
    for f in files:
        if f not in seen:
            seen.add(f)
            unique.append(f)
    return sorted(unique, key=lambda p: (get_strain(p, root), get_run(p), p.name))


def load_image_array(path: Path) -> np.ndarray:
    ext = path.suffix.lower()
    if ext in (".tif", ".tiff"):
        import tifffile
        img = tifffile.imread(str(path))
    elif ext in (".jpg", ".jpeg", ".png"):
        from skimage import io as skio
        img = skio.imread(str(path))
        if img.ndim == 3:
            # Convert RGB/RGBA to grayscale
            from skimage.color import rgb2gray
            img = (rgb2gray(img[..., :3]) * 65535).astype(np.uint16)
    else:
        import tifffile
        img = tifffile.imread(str(path))
    return img


class BatchViewer(QWidget):
    def __init__(self, viewer: napari.Viewer, files: list[Path],
                 root: Path, target: int):
        super().__init__()
        self.viewer = viewer
        self.files = files
        self.root = root
        self.target = target
        self.current_idx = 0
        self.selected: set[str] = set()
        self.viewed: set[str] = set()

        if SELECTIONS_FILE.exists():
            data = json.loads(SELECTIONS_FILE.read_text())
            self.selected = set(data.get("selected", []))
            self.viewed = set(data.get("viewed", []))

        self._build_ui()
        self._load_current()

        viewer.bind_key("Right", self._next)
        viewer.bind_key("Left",  self._prev)
        viewer.bind_key("Space", self._toggle_select)
        viewer.bind_key("s",     self._save)
        viewer.bind_key("j",     self._jump_unviewed)
        viewer.bind_key("f",     self._skip_forward)
        viewer.bind_key("b",     self._skip_back)

    # ── UI ─────────────────────────────────────────────────────────────────

    def _build_ui(self):
        layout = QVBoxLayout()
        self.setLayout(layout)
        self.setMinimumWidth(300)

        self.strain_label = QLabel()
        f = QFont(); f.setPointSize(18); f.setBold(True)
        self.strain_label.setFont(f)
        self.strain_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.strain_label)

        self.run_label = QLabel()
        self.run_label.setWordWrap(True)
        self.run_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.run_label)

        self.file_label = QLabel()
        self.file_label.setWordWrap(True)
        self.file_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.file_label)

        self.progress_bar = QProgressBar()
        self.progress_bar.setMaximum(len(self.files))
        layout.addWidget(self.progress_bar)

        self.progress_label = QLabel()
        self.progress_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.progress_label)

        self.select_label = QLabel()
        self.select_label.setAlignment(Qt.AlignCenter)
        f2 = QFont(); f2.setPointSize(14); f2.setBold(True)
        self.select_label.setFont(f2)
        layout.addWidget(self.select_label)

        nav = QHBoxLayout()
        self.prev_btn = QPushButton("← Prev")
        self.prev_btn.clicked.connect(self._prev)
        nav.addWidget(self.prev_btn)
        self.select_btn = QPushButton("Mark Good [Space]")
        self.select_btn.clicked.connect(self._toggle_select)
        nav.addWidget(self.select_btn)
        self.next_btn = QPushButton("Next →")
        self.next_btn.clicked.connect(self._next)
        nav.addWidget(self.next_btn)
        layout.addLayout(nav)

        skip = QHBoxLayout()
        b10 = QPushButton("← -10 [B]"); b10.clicked.connect(self._skip_back)
        skip.addWidget(b10)
        jump = QPushButton("Jump unviewed [J]"); jump.clicked.connect(self._jump_unviewed)
        skip.addWidget(jump)
        f10 = QPushButton("+10 → [F]"); f10.clicked.connect(self._skip_forward)
        skip.addWidget(f10)
        layout.addLayout(skip)

        save_btn = QPushButton("Save [S]")
        save_btn.clicked.connect(self._save)
        layout.addWidget(save_btn)

        self.count_label = QLabel()
        self.count_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.count_label)

        layout.addWidget(QLabel("Selected images:"))
        self.selected_list = QListWidget()
        self.selected_list.setMaximumHeight(180)
        self.selected_list.itemDoubleClicked.connect(self._jump_to_item)
        layout.addWidget(self.selected_list)

    # ── Image loading ──────────────────────────────────────────────────────

    def _load_current(self):
        path = self.files[self.current_idx]
        self.viewed.add(str(path))
        try:
            img = load_image_array(path)
            self.viewer.layers.clear()
            self.viewer.add_image(
                img,
                name=f"{get_strain(path, self.root)}  |  {path.name}",
                colormap="gray",
            )
            self.viewer.reset_view()
        except Exception as e:
            print(f"Error loading {path}: {e}")
        self._update_ui()

    # ── UI updates ─────────────────────────────────────────────────────────

    def _update_ui(self):
        path = self.files[self.current_idx]
        strain = get_strain(path, self.root)
        is_selected = str(path) in self.selected

        self.strain_label.setText(strain)
        self.run_label.setText(get_run(path))
        self.file_label.setText(path.name)
        self.progress_bar.setValue(self.current_idx + 1)
        self.progress_label.setText(
            f"{self.current_idx + 1} / {len(self.files)}  "
            f"({len(self.viewed)} viewed)"
        )

        if is_selected:
            self.select_label.setText("✔  SELECTED")
            self.select_label.setStyleSheet("color: #00cc44;")
            self.select_btn.setText("Unmark [Space]")
            self.select_btn.setStyleSheet("background-color: #005522;")
        else:
            self.select_label.setText("")
            self.select_label.setStyleSheet("")
            self.select_btn.setText("Mark Good [Space]")
            self.select_btn.setStyleSheet("")

        self.count_label.setText(f"Selected: {len(self.selected)} / {self.target}")

        self.selected_list.clear()
        for s in sorted(self.selected):
            p = Path(s)
            item = QListWidgetItem(f"{get_strain(p, self.root)}  |  {p.name}")
            item.setData(Qt.UserRole, s)
            self.selected_list.addItem(item)

    # ── Navigation ─────────────────────────────────────────────────────────

    def _next(self, _=None):
        if self.current_idx < len(self.files) - 1:
            self.current_idx += 1
            self._load_current()

    def _prev(self, _=None):
        if self.current_idx > 0:
            self.current_idx -= 1
            self._load_current()

    def _skip_forward(self, _=None):
        self.current_idx = min(self.current_idx + 10, len(self.files) - 1)
        self._load_current()

    def _skip_back(self, _=None):
        self.current_idx = max(self.current_idx - 10, 0)
        self._load_current()

    def _jump_unviewed(self, _=None):
        for i, f in enumerate(self.files):
            if str(f) not in self.viewed:
                self.current_idx = i
                self._load_current()
                return
        print("All files viewed.")

    def _jump_to_item(self, item: QListWidgetItem):
        path_str = item.data(Qt.UserRole)
        for i, f in enumerate(self.files):
            if str(f) == path_str:
                self.current_idx = i
                self._load_current()
                return

    # ── Selection ──────────────────────────────────────────────────────────

    def _toggle_select(self, _=None):
        path_str = str(self.files[self.current_idx])
        if path_str in self.selected:
            self.selected.discard(path_str)
        else:
            self.selected.add(path_str)
        self._update_ui()
        self._save()

    def _save(self, _=None):
        data = {
            "selected": sorted(self.selected),
            "viewed":   sorted(self.viewed),
            "count":    len(self.selected),
        }
        SELECTIONS_FILE.write_text(json.dumps(data, indent=2))
        print(f"Saved {len(self.selected)} selections → {SELECTIONS_FILE}")


# ── Entry point ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Browse images and select training examples."
    )
    parser.add_argument("dir", nargs="?", default=None,
                        help="Directory to scan (default: project root)")
    parser.add_argument("--target", type=int, default=30,
                        help="Target number of selections to aim for (default: 30)")
    args = parser.parse_args()

    root = Path(args.dir) if args.dir else ROOT
    print(f"Scanning {root} …")
    files = collect_files(root)

    if not files:
        print("No image files found (TIFF, OME-TIFF, JPEG, PNG).")
        sys.exit(1)

    from collections import Counter
    strains = Counter(get_strain(f, root) for f in files)
    print(f"\nFound {len(files)} images:")
    for s, n in sorted(strains.items()):
        print(f"  {s:25s}  {n}")

    if SELECTIONS_FILE.exists():
        data = json.loads(SELECTIONS_FILE.read_text())
        print(f"\nResuming: {len(data.get('viewed', []))} viewed, "
              f"{len(data.get('selected', []))} selected")

    print("\nControls: ← → navigate | Space = mark | F/B = ±10 | J = unviewed | S = save\n")

    viewer = napari.Viewer(title="Select Training Images")
    widget = BatchViewer(viewer, files, root, args.target)
    viewer.window.add_dock_widget(widget, name="Image Selector", area="right")
    napari.run()


if __name__ == "__main__":
    main()
