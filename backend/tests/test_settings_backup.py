"""Tests for settings export/import/reset endpoints."""
import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


# We import the app after patching to avoid side effects during module load.
# The patches target backend.main's namespace where get_settings and save_settings
# are used (already imported at module level via `from .settings import ...`).


def _make_default_settings():
    """Return a fresh Settings instance (calls backend.settings.Settings())."""
    from backend.settings import Settings
    return Settings()


def _make_settings_with_keys():
    """Return a Settings instance with some API keys set."""
    from backend.settings import Settings
    return Settings(
        openrouter_api_key="sk-or-test-key-123",
        groq_api_key="gsk_test_key_456",
    )


@pytest.fixture()
def client():
    """TestClient with mocked filesystem settings functions."""
    with patch("backend.main.get_settings") as mock_get, \
         patch("backend.main.save_settings") as mock_save:
        mock_get.return_value = _make_default_settings()
        mock_save.return_value = None
        from backend.main import app
        with TestClient(app) as c:
            # Expose mocks via the client so individual tests can reconfigure them.
            c._mock_get = mock_get
            c._mock_save = mock_save
            yield c


# ---------------------------------------------------------------------------
# Export tests
# ---------------------------------------------------------------------------


def test_export_returns_json_download(client):
    """GET /api/settings/export should return 200 with Content-Disposition attachment."""
    response = client.get("/api/settings/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    cd = response.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert "council-settings.json" in cd


def test_export_includes_api_key_values(client):
    """Exported JSON must contain actual key fields, not _key_set booleans."""
    # Reconfigure mock to return settings with a real key value.
    client._mock_get.return_value = _make_settings_with_keys()
    response = client.get("/api/settings/export")
    assert response.status_code == 200
    data = response.json()
    # The real key value must be present (not a boolean *_key_set field).
    assert data.get("openrouter_api_key") == "sk-or-test-key-123"
    assert data.get("groq_api_key") == "gsk_test_key_456"
    # Ensure there are no *_key_set fields (those only appear in the secure GET endpoint).
    for key in data:
        assert not key.endswith("_key_set"), f"Unexpected boolean key field: {key}"


# ---------------------------------------------------------------------------
# Import tests
# ---------------------------------------------------------------------------


def test_import_valid_settings(client):
    """POST /api/settings/import with a valid blob returns status=imported."""
    from backend.settings import Settings
    payload = Settings().model_dump(mode="json")
    response = client.post("/api/settings/import", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "imported"
    # save_settings should have been called exactly once.
    client._mock_save.assert_called_once()


def test_import_invalid_json(client):
    """POST /api/settings/import with non-JSON body returns 400."""
    response = client.post(
        "/api/settings/import",
        content=b"this is not json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400


def test_import_invalid_settings(client):
    """POST /api/settings/import with a field of the wrong type returns 400."""
    # council_temperature must be a float; passing a string should fail validation.
    bad_payload = {"council_temperature": "not-a-number"}
    response = client.post("/api/settings/import", json=bad_payload)
    assert response.status_code == 400
    assert "Invalid settings" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Reset tests
# ---------------------------------------------------------------------------


def test_reset_returns_success(client):
    """POST /api/settings/reset returns status=reset."""
    response = client.post("/api/settings/reset")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "reset"


def test_reset_saves_defaults(client):
    """After reset, exported settings match fresh Settings() defaults."""
    # Call reset first.
    reset_resp = client.post("/api/settings/reset")
    assert reset_resp.status_code == 200

    # save_settings was called; grab the argument it was called with.
    call_args = client._mock_save.call_args
    assert call_args is not None
    saved_settings = call_args[0][0]  # First positional argument

    from backend.settings import Settings
    defaults = Settings()

    # Core defaults should match.
    assert saved_settings.council_temperature == defaults.council_temperature
    assert saved_settings.chairman_temperature == defaults.chairman_temperature
    assert saved_settings.council_models == defaults.council_models
    assert saved_settings.chairman_model == defaults.chairman_model
    # API keys should be None (default).
    assert saved_settings.openrouter_api_key is None
    assert saved_settings.groq_api_key is None
