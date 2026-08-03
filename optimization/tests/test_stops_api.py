from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from app.main import app, get_osrm_client
from app.osrm import OsrmError, OsrmFootClient


client = TestClient(app)


def test_generate_stops_accepts_valid_request() -> None:
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.get_distance_matrix.return_value = [[0.0]]
    app.dependency_overrides[get_osrm_client] = lambda: osrm

    try:
        response = client.post(
            "/api/v1/stops/generate",
            json={
                "persons": [
                    {
                        "id": "person-001",
                        "location": [32.8597, 39.9334],
                    }
                ],
                "maxWalkingDistanceMeters": 500,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "stops": [
            {
                "id": "stop-candidate-001",
                "location": [32.8597, 39.9334],
                "assignedPersonIds": ["person-001"],
                "walkingDistancesMeters": {"person-001": 0.0},
                "demand": 1,
                "qualityScore": 1.0,
            }
        ],
        "unassignedPersonIds": [],
    }


def test_generate_stops_returns_503_when_osrm_is_unavailable() -> None:
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.get_distance_matrix.side_effect = OsrmError(
        "OSRM foot servisine ulaşılamadı."
    )
    app.dependency_overrides[get_osrm_client] = lambda: osrm

    try:
        response = client.post(
            "/api/v1/stops/generate",
            json={
                "persons": [
                    {
                        "id": "person-001",
                        "location": [32.8597, 39.9334],
                    }
                ],
                "maxWalkingDistanceMeters": 500,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {
        "detail": "OSRM foot servisine ulaşılamadı."
    }


def test_generate_stops_handles_multiple_people_end_to_end() -> None:
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.get_distance_matrix.return_value = [
        [0.0, 300.0, 700.0],
        [300.0, 0.0, 700.0],
        [700.0, 700.0, 0.0],
    ]
    app.dependency_overrides[get_osrm_client] = lambda: osrm

    try:
        response = client.post(
            "/api/v1/stops/generate",
            json={
                "persons": [
                    {"id": "person-001", "location": [32.85, 39.93]},
                    {"id": "person-002", "location": [32.86, 39.94]},
                    {"id": "person-003", "location": [32.87, 39.95]},
                ],
                "maxWalkingDistanceMeters": 500,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    result = response.json()
    assert len(result["stops"]) == 2
    assert result["stops"][0]["assignedPersonIds"] == [
        "person-001",
        "person-002",
    ]
    assert sum(stop["demand"] for stop in result["stops"]) == 3
    assert result["unassignedPersonIds"] == []


def test_generate_stops_returns_503_for_invalid_osrm_matrix() -> None:
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.get_distance_matrix.return_value = [[0.0]]
    app.dependency_overrides[get_osrm_client] = lambda: osrm

    try:
        response = client.post(
            "/api/v1/stops/generate",
            json={
                "persons": [
                    {"id": "person-001", "location": [32.85, 39.93]},
                    {"id": "person-002", "location": [32.86, 39.94]},
                ],
                "maxWalkingDistanceMeters": 500,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert "personel satır sayısı" in response.json()["detail"]


def test_generate_stops_requires_walking_distance() -> None:
    response = client.post(
        "/api/v1/stops/generate",
        json={
            "persons": [
                {
                    "id": "person-001",
                    "location": [32.8597, 39.9334],
                }
            ]
        },
    )

    assert response.status_code == 422


def test_generate_stops_rejects_distance_above_500() -> None:
    response = client.post(
        "/api/v1/stops/generate",
        json={
            "persons": [
                {
                    "id": "person-001",
                    "location": [32.8597, 39.9334],
                }
            ],
            "maxWalkingDistanceMeters": 501,
        },
    )

    assert response.status_code == 422
