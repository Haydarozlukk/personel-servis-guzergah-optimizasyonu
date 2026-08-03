from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.main import app, get_osrm_client
from app.osrm import OsrmError, OsrmFootClient, WalkingMatrix

client = TestClient(app)


def _request(persons: list[dict], max_stop_demand: int | None = None):
    payload = {"persons": persons, "maxWalkingDistanceMeters": 500}
    if max_stop_demand is not None:
        payload["maxStopDemand"] = max_stop_demand
    return client.post("/api/v1/stops/generate", json=payload)


def test_generate_stops_returns_metrics_and_respects_capacity() -> None:
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.snap_locations.return_value = [(32.851, 39.931), (32.861, 39.941)]
    osrm.get_walking_matrix.return_value = WalkingMatrix(
        [[100.0, 400.0], [200.0, 300.0]],
        [[70.0, 280.0], [140.0, 210.0]], 1,
    )
    app.dependency_overrides[get_osrm_client] = lambda: osrm
    try:
        response = _request([
            {"id": "p1", "location": [32.85, 39.93]},
            {"id": "p2", "location": [32.86, 39.94]},
        ], 1)
    finally:
        app.dependency_overrides.clear()
    result = response.json()
    assert response.status_code == 200
    assert len(result["stops"]) == 2
    assert max(stop["demand"] for stop in result["stops"]) == 1
    assert result["summary"]["assignedPersonCount"] == 2
    assert result["summary"]["maximumWalkingDistanceMeters"] == 300.0
    assert result["summary"]["matrixChunkCount"] == 1


def test_generate_stops_returns_503_when_osrm_is_unavailable() -> None:
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.snap_locations.side_effect = OsrmError("OSRM foot servisine ulaşılamadı.")
    app.dependency_overrides[get_osrm_client] = lambda: osrm
    try:
        response = _request([{"id": "p1", "location": [32.85, 39.93]}])
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 503


def test_unreachable_person_has_no_route_reason() -> None:
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.snap_locations.return_value = [(32.851, 39.931)]
    osrm.get_walking_matrix.return_value = WalkingMatrix([[None]], [[None]], 1)
    app.dependency_overrides[get_osrm_client] = lambda: osrm
    try:
        response = _request([{"id": "p1", "location": [32.85, 39.93]}])
    finally:
        app.dependency_overrides.clear()
    assert response.json()["unassignedPersons"] == [{"id": "p1", "reason": "no_route"}]


def test_distance_above_500_is_rejected() -> None:
    app.dependency_overrides[get_osrm_client] = lambda: AsyncMock(spec=OsrmFootClient)
    try:
        response = client.post("/api/v1/stops/generate", json={
            "persons": [{"id": "p1", "location": [32.85, 39.93]}],
            "maxWalkingDistanceMeters": 501,
        })
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422


def test_200_people_complete_in_one_api_call() -> None:
    people = [
        {"id": f"p{index:03d}", "location": [32.85 + index * 0.002, 39.93]}
        for index in range(200)
    ]
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.snap_locations.side_effect = lambda locations: locations

    async def matrix(sources, destinations):
        return WalkingMatrix(
            [[100.0 for _ in destinations] for _ in sources],
            [[70.0 for _ in destinations] for _ in sources],
            4,
        )

    osrm.get_walking_matrix.side_effect = matrix
    app.dependency_overrides[get_osrm_client] = lambda: osrm
    try:
        response = _request(people, 16)
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["summary"]["assignedPersonCount"] == 200
    assert max(stop["demand"] for stop in response.json()["stops"]) <= 16
