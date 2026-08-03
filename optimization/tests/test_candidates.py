import asyncio
from unittest.mock import AsyncMock

from app.candidates import generate_candidate_seed_locations, generate_stop_candidates
from app.models import Person
from app.osrm import OsrmFootClient


def test_nearby_people_share_a_grid_candidate() -> None:
    persons = [
        Person(id="p1", location=(32.85000, 39.93000)),
        Person(id="p2", location=(32.85005, 39.93005)),
    ]
    seeds = generate_candidate_seed_locations(persons)
    assert len(seeds) == 1
    assert seeds[0] != persons[0].location
    assert seeds[0] != persons[1].location


def test_candidates_are_snapped_and_close_ones_are_merged() -> None:
    persons = [
        Person(id="p1", location=(32.8500, 39.9300)),
        Person(id="p2", location=(32.8600, 39.9400)),
    ]
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.snap_locations.return_value = [(32.851, 39.931), (32.8511, 39.9311)]
    candidates = asyncio.run(generate_stop_candidates(persons, osrm))
    assert len(candidates) == 1
    assert candidates[0].location == (32.851, 39.931)


def test_empty_person_list_produces_no_candidates() -> None:
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.snap_locations.return_value = []
    assert asyncio.run(generate_stop_candidates([], osrm)) == []
