"""
Measurement plugin registry.

To add a new measurement, create a function in any measurements/*.py file
and decorate it with @register(...). It will be automatically available
to all analyses.

Example:
    @register("my_measurement", unit="µm", description="What it measures")
    def my_measurement(props, pixel_size_um: float, feret_data: dict | None) -> float:
        return round(props.some_property * pixel_size_um, 3)
"""
from __future__ import annotations
from typing import Callable, Any

_REGISTRY: dict[str, dict] = {}


def register(name: str, unit: str = "", description: str = "", requires_feret: bool = False):
    """Decorator to register a measurement function."""
    def decorator(fn: Callable):
        _REGISTRY[name] = {
            "fn": fn,
            "unit": unit,
            "description": description,
            "requires_feret": requires_feret,
        }
        return fn
    return decorator


def available() -> list[str]:
    """Return all registered measurement names."""
    return list(_REGISTRY.keys())


def metadata() -> list[dict]:
    """Return list of {name, unit, description, requires_feret} for all measurements."""
    return [
        {
            "name": k,
            "unit": v["unit"],
            "description": v["description"],
            "requires_feret": v["requires_feret"],
        }
        for k, v in _REGISTRY.items()
    ]


def compute_all(
    props,
    pixel_size_um: float,
    feret_data: dict | None = None,
    selected: list[str] | None = None,
) -> dict:
    """Compute all (or a selected subset) of registered measurements for one cell."""
    names = selected if selected is not None else available()
    result: dict[str, Any] = {"cell_id": props.label}
    for name in names:
        entry = _REGISTRY.get(name)
        if entry is None:
            result[name] = None
            continue
        if entry["requires_feret"] and feret_data is None:
            result[name] = None
            continue
        try:
            result[name] = entry["fn"](props, pixel_size_um, feret_data)
        except Exception:
            result[name] = None
    return result


# Auto-load all measurement modules in this package
import importlib
import pkgutil
import os as _os

_pkg_dir = _os.path.dirname(__file__)
for _importer, _modname, _ispkg in pkgutil.iter_modules([_pkg_dir]):
    importlib.import_module(f".{_modname}", package=__name__)
