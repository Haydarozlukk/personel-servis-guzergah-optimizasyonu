import asyncio
from unittest.mock import AsyncMock

import pytest

from app.evaluation import analyze_stop_candidates, evaluate_candidates
from app.models import Person, StopCandidate
from app.osrm import OsrmError, OsrmFootClient, WalkingMatrix


def test_coverage_distance_duration_and_quality_are_calculated() -> None:
    persons = [Person(id="p1", location=(32.85, 39.93)), Person(id="p2", location=(32.86, 39.94))]
    candidate = StopCandidate(id="s1", location=(32.855, 39.935))
    evaluation = evaluate_candidates(
        persons, [candidate], [[100.0], [500.0]], 500, [[70.0], [350.0]]
    )[0]
    assert evaluation.coveredPersonIds == ["p1", "p2"]
    assert evaluation.walkingDurationsSeconds == {"p1": 70.0, "p2": 350.0}
    assert evaluation.averageWalkingDistanceMeters == 300.0
    assert evaluation.qualityScore == 1.0


def test_none_and_above_limit_are_not_covered() -> None:
    persons = [Person(id="p1", location=(32.85, 39.93)), Person(id="p2", location=(32.86, 39.94))]
    candidate = StopCandidate(id="s1", location=(32.855, 39.935))
    evaluation = evaluate_candidates(persons, [candidate], [[None], [500.1]], 500)[0]
    assert evaluation.coveredPersonIds == []


def test_analysis_assigns_distinct_unassigned_reasons() -> None:
    persons = [Person(id="p1", location=(32.85, 39.93)), Person(id="p2", location=(32.86, 39.94))]
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.snap_locations.return_value = [(32.855, 39.935)]
    osrm.get_walking_matrix.return_value = WalkingMatrix([[None], [700.0]], [[None], [500.0]], 1)
    analysis = asyncio.run(analyze_stop_candidates(persons, 500, osrm))
    assert analysis.initial_unassigned_reasons == {
        "p1": "no_route", "p2": "no_candidate_within_limit"
    }


def test_invalid_matrix_shape_is_rejected() -> None:
    person = Person(id="p1", location=(32.85, 39.93))
    candidate = StopCandidate(id="s1", location=(32.855, 39.935))
    with pytest.raises(OsrmError, match="personel satır sayısı"):
        evaluate_candidates([person], [candidate], [], 500)
