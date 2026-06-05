"""Tests for curation endpoints: toggle, accept-all, reject-all, cells list."""


def test_toggle_cell_default_accepted(client, seeded_measurements):
    """First toggle of an unset cell should set it to False (default is True)."""
    r = client.post("/api/curation/toggle", json={
        "filename": "img001.tif",
        "cell_id": 1,
        "analysis_id": "test_analysis",
    })
    assert r.status_code == 200
    assert r.json()["selected"] is False


def test_toggle_cell_twice_returns_to_default(client, seeded_measurements):
    for _ in range(2):
        client.post("/api/curation/toggle", json={
            "filename": "img001.tif",
            "cell_id": 1,
            "analysis_id": "test_analysis",
        })
    r = client.post("/api/curation/toggle", json={
        "filename": "img001.tif",
        "cell_id": 1,
        "analysis_id": "test_analysis",
    })
    assert r.json()["selected"] is False


def test_toggle_missing_fields_rejected(client):
    r = client.post("/api/curation/toggle", json={"filename": "", "cell_id": None})
    assert r.status_code == 400


def test_accept_all(client, seeded_measurements):
    r = client.post("/api/curation/accept-all/0?analysis_id=test_analysis")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_reject_all(client, seeded_measurements):
    r = client.post("/api/curation/reject-all/0?analysis_id=test_analysis")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_accept_reject_out_of_range(client, seeded_measurements):
    r = client.post("/api/curation/accept-all/99?analysis_id=test_analysis")
    assert r.status_code == 404


def test_curation_cells_list(client, seeded_measurements):
    r = client.get("/api/curation/cells?analysis_id=test_analysis&strain=TestStrain")
    assert r.status_code == 200
    cells = r.json()
    assert len(cells) == 1
    assert cells[0]["cell_id"] == 1
