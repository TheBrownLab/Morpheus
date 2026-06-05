"""Shared defaults for the Morpheus pipeline and web backend."""

# Microscope defaults (60× oil, Hamamatsu ORCA-ERA)
DEFAULT_PIXEL_SIZE_UM: float = 0.1075

# Cell filtering defaults
DEFAULT_MIN_AREA: int = 300
DEFAULT_MAX_AREA: int = 500_000

# Cell crop padding (pixels around bbox)
DEFAULT_CROP_PAD: int = 40

# UI defaults
DEFAULT_STRAIN_COLOR: str = "#4ade80"

# Conda environment names tried in order during auto-detection
CONDA_ENV_NAMES: list[str] = ["morpheus", "morpheus-env"]

# Image file extensions recognised by the importer
SUPPORTED_IMAGE_EXTS: frozenset[str] = frozenset({".tif", ".tiff", ".jpg", ".jpeg", ".png"})
