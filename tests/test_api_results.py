"""Tests for results endpoints: summary, chart-data."""


def test_results_summary_returns_list(client, seeded_measurements):
    r = client.get("/api/results/summary?analysis_id=test_analysis")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    row = data[0]
    assert row["strain"] == "TestStrain"
    assert "n_cells" in row


def test_results_summary_empty_without_measurements(client, seeded_config):
    """Returns empty list when no measurements.json exists (exception is swallowed by _build_curated_df)."""
    r = client.get("/api/results/summary?analysis_id=test_analysis")
    assert r.status_code == 200
    assert r.json() == []


def test_chart_data_returns_rows(client, seeded_measurements):
    r = client.get("/api/results/chart-data?analysis_id=test_analysis")
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) == 1
    row = rows[0]
    assert row["strain"] == "TestStrain"
    assert row["morphotype"] == "accepted"
    assert "length_um" in row


def test_chart_data_reflects_rejection(client, seeded_measurements):
    """Toggling a cell should change its morphotype in chart-data to 'rejected'."""
    client.post("/api/curation/toggle", json={
        "filename": "img001.tif",
        "cell_id": 1,
        "analysis_id": "test_analysis",
    })
    r = client.get("/api/results/chart-data?analysis_id=test_analysis")
    rows = r.json()
    assert rows[0]["morphotype"] == "rejected"


def test_schema_version_legacy_list(client, tmp_repo, seeded_config):
    """Legacy bare-list measurements.json should still load (with a deprecation warning)."""
    import json
    analysis_dir = tmp_repo / "results" / "test_analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)
    # Write old-style bare list
    images = [{
        "strain": "TestStrain",
        "filename": "img001.tif",
        "filepath": str(tmp_repo / "data" / "curated" / "test_analysis" / "TestStrain" / "img001.tif"),
        "seg_path": "",
        "pixel_size_um": 0.1075,
        "cells": [{
            "cell_id": 1, "length_um": 20.0, "breadth_um": 8.0, "aspect_ratio": 2.5,
            "area_um2": 140.0, "area_px": 12123, "solidity": 0.92, "perimeter_um": 55.0,
            "centroid_y_px": 400.0, "centroid_x_px": 200.0, "orientation_rad": 1.0,
            "bbox": [350, 160, 460, 250], "crop_path": "", "feret_crop_path": "",
            "feret_max_um": 19.5, "feret_min_um": 8.2, "feret_max_angle_rad": 1.01,
            "feret_min_angle_rad": 2.58, "feret_aspect_ratio": 2.38, "pixel_size_um": 0.1075,
        }],
    }]
    (analysis_dir / "measurements.json").write_text(json.dumps(images))

    r = client.get("/api/results/chart-data?analysis_id=test_analysis")
    assert r.status_code == 200
    assert len(r.json()) == 1
