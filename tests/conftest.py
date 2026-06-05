"""Shared test fixtures for the Morpheus FastAPI backend."""
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import app


@pytest.fixture()
def tmp_repo(tmp_path, monkeypatch):
    """Redirect all file-system globals in app.py to a temp directory."""
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "data" / "input").mkdir(parents=True)
    (repo / "data" / "curated").mkdir(parents=True)
    (repo / "data" / "training").mkdir(parents=True)
    (repo / "results").mkdir()

    monkeypatch.setattr(app_module, "REPO_DIR",       repo)
    monkeypatch.setattr(app_module, "DATA_DIR",        repo / "data")
    monkeypatch.setattr(app_module, "INPUT_DIR",       repo / "data" / "input")
    monkeypatch.setattr(app_module, "CURATED_DIR",     repo / "data" / "curated")
    monkeypatch.setattr(app_module, "TRAINING_DIR",    repo / "data" / "training")
    monkeypatch.setattr(app_module, "RESULTS_DIR",     repo / "results")
    monkeypatch.setattr(app_module, "CONFIG_FILE",     repo / "config.json")
    monkeypatch.setattr(app_module, "CURATION_STATE_FILE", repo / "curation_state.json")
    # Clear any cached env status from a previous test
    app_module._env_status_cache.clear()
    return repo


@pytest.fixture()
def client(tmp_repo):
    return TestClient(app)


@pytest.fixture()
def seeded_config(tmp_repo):
    """Write a minimal config.json with one strain and one analysis."""
    cfg = {
        "strains": [{"name": "TestStrain", "source_dir": "", "color": "#4ade80"}],
        "analyses": [
            {
                "id": "test_analysis",
                "name": "Test Analysis",
                "model_path": "test_model",
                "measurements": ["length_um", "breadth_um"],
                "min_area": 300,
                "max_area": 500000,
                "diameter": None,
                "pixel_size_um": 0.1075,
                "pixels_per_um": None,
                "strain_models": {},
            }
        ],
        "objectives": [],
    }
    (tmp_repo / "config.json").write_text(json.dumps(cfg))
    return cfg


@pytest.fixture()
def seeded_measurements(tmp_repo, seeded_config):
    """Write a minimal versioned measurements.json for test_analysis."""
    analysis_dir = tmp_repo / "results" / "test_analysis"
    analysis_dir.mkdir(parents=True)
    images = [
        {
            "strain": "TestStrain",
            "filename": "img001.tif",
            "filepath": str(tmp_repo / "data" / "curated" / "test_analysis" / "TestStrain" / "img001.tif"),
            "seg_path": "",
            "pixel_size_um": 0.1075,
            "cells": [
                {
                    "cell_id": 1,
                    "length_um": 20.0,
                    "breadth_um": 8.0,
                    "aspect_ratio": 2.5,
                    "area_um2": 140.0,
                    "area_px": 12123,
                    "solidity": 0.92,
                    "perimeter_um": 55.0,
                    "centroid_y_px": 400.0,
                    "centroid_x_px": 200.0,
                    "orientation_rad": 1.0,
                    "bbox": [350, 160, 460, 250],
                    "crop_path": "",
                    "feret_crop_path": "",
                    "feret_max_um": 19.5,
                    "feret_min_um": 8.2,
                    "feret_max_angle_rad": 1.01,
                    "feret_min_angle_rad": 2.58,
                    "feret_aspect_ratio": 2.38,
                    "pixel_size_um": 0.1075,
                }
            ],
        }
    ]
    payload = {"schema_version": 1, "images": images}
    (analysis_dir / "measurements.json").write_text(json.dumps(payload))
    return images
