"""Tests for config CRUD endpoints: strains and analyses."""
import json


def test_get_config_empty(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    data = r.json()
    assert data["strains"] == []
    assert data["analyses"] == []


def test_add_strain(client):
    r = client.post("/api/config/strain/add", json={"name": "Naegleria", "source_dir": ""})
    assert r.status_code == 200
    strains = r.json()["strains"]
    assert any(s["name"] == "Naegleria" for s in strains)


def test_add_strain_duplicate_rejected(client):
    client.post("/api/config/strain/add", json={"name": "Naegleria", "source_dir": ""})
    r = client.post("/api/config/strain/add", json={"name": "Naegleria", "source_dir": ""})
    assert r.status_code == 400


def test_add_strain_missing_name_rejected(client):
    r = client.post("/api/config/strain/add", json={"name": "", "source_dir": ""})
    assert r.status_code == 400


def test_delete_strain(client):
    client.post("/api/config/strain/add", json={"name": "Naegleria", "source_dir": ""})
    r = client.delete("/api/config/strain/Naegleria")
    assert r.status_code == 200
    cfg = client.get("/api/config").json()
    assert not any(s["name"] == "Naegleria" for s in cfg["strains"])


def test_add_analysis(client):
    body = {
        "id": "my_analysis",
        "name": "My Analysis",
        "model_path": "test_model",
        "measurements": ["length_um"],
        "min_area": 300,
        "max_area": 500000,
        "pixel_size_um": 0.1075,
    }
    r = client.post("/api/analyses/add", json=body)
    assert r.status_code == 200
    # Endpoint returns the new analysis dict directly
    assert r.json()["id"] == "my_analysis"
    # Verify it's persisted in config
    cfg = client.get("/api/config").json()
    assert any(a["id"] == "my_analysis" for a in cfg["analyses"])


def test_delete_analysis(client, seeded_config):
    r = client.delete("/api/analyses/test_analysis")
    assert r.status_code == 200
    cfg = client.get("/api/config").json()
    assert not any(a["id"] == "test_analysis" for a in cfg["analyses"])


def test_strain_default_color(client):
    client.post("/api/config/strain/add", json={"name": "Colorless", "source_dir": ""})
    cfg = client.get("/api/config").json()
    strain = next(s for s in cfg["strains"] if s["name"] == "Colorless")
    assert strain["color"] == "#4ade80"
