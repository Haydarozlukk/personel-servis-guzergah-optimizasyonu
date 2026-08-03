import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

import pytest


RUN_FULL_STACK = os.getenv("RUN_FULL_STACK_INTEGRATION") == "1"
ROOT = Path(__file__).resolve().parents[2]


def post_json(url: str, payload: dict) -> dict:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        return json.load(response)


def get_json(url: str) -> dict:
    with urlopen(url, timeout=30) as response:
        return json.load(response)


def load_scenario() -> dict:
    with (ROOT / "samples" / "poc-scenario-50.json").open(encoding="utf-8") as file:
        return json.load(file)


@pytest.mark.skipif(not RUN_FULL_STACK, reason="Tam Docker yığını açıkça istendiğinde çalışır.")
def test_real_walking_distances_never_exceed_500_meters() -> None:
    scenario = load_scenario()
    result = post_json(
        "http://localhost:8000/api/v1/stops/generate",
        {
            "persons": scenario["persons"],
            "maxWalkingDistanceMeters": 500,
        },
    )

    distances = [
        distance
        for stop in result["stops"]
        for distance in stop["walkingDistancesMeters"].values()
    ]

    assert sum(stop["demand"] for stop in result["stops"]) == 50
    assert result["unassignedPersonIds"] == []
    assert max(distances) <= 500


@pytest.mark.skipif(not RUN_FULL_STACK, reason="Tam Docker yığını açıkça istendiğinde çalışır.")
def test_real_vroom_routes_respect_all_vehicle_capacities() -> None:
    scenario = load_scenario()
    accepted = post_json("http://localhost:8080/api/v1/scenarios", scenario)
    result = get_json(f"http://localhost:8080/api/v1/scenarios/{accepted['id']}")
    capacities = {vehicle["id"]: vehicle["capacity"] for vehicle in scenario["vehicles"]}

    assert result["status"] == "completed"
    assert result["unassignedPersonIds"] == []
    assert sum(route["load"] for route in result["routes"]) == 50
    assert all(
        route["load"] <= capacities[route["vehicleId"]]
        for route in result["routes"]
    )


@pytest.mark.skipif(not RUN_FULL_STACK, reason="Tam Docker yığını açıkça istendiğinde çalışır.")
def test_real_vroom_reports_people_over_total_capacity_as_unassigned() -> None:
    scenario = load_scenario()
    scenario["vehicles"] = scenario["vehicles"][:1]
    accepted = post_json("http://localhost:8080/api/v1/scenarios", scenario)
    result = get_json(f"http://localhost:8080/api/v1/scenarios/{accepted['id']}")

    assigned_count = sum(route["load"] for route in result["routes"])

    assert result["status"] == "completed"
    assert assigned_count <= scenario["vehicles"][0]["capacity"]
    assert len(result["unassignedPersonIds"]) == 50 - assigned_count
    assert assigned_count + len(result["unassignedPersonIds"]) == 50
