import asyncio
from unittest.mock import AsyncMock

import pytest

from app.evaluation import analyze_stop_candidates, evaluate_candidates
from app.models import Person, StopCandidate
from app.osrm import OsrmError, OsrmFootClient


def test_candidate_coverage_and_quality_are_calculated() -> None:
    persons = [
        Person(id="person-001", location=(32.8500, 39.9300)),
        Person(id="person-002", location=(32.8600, 39.9400)),
    ]
    candidates = [
        StopCandidate(id="stop-candidate-001", location=(32.8500, 39.9300)),
        StopCandidate(id="stop-candidate-002", location=(32.8600, 39.9400)),
    ]

    evaluations = evaluate_candidates(
        persons=persons,
        candidates=candidates,
        distance_matrix=[
            [0.0, 600.0],
            [400.0, 0.0],
        ],
        max_walking_distance_meters=500,
    )

    first = evaluations[0]
    assert first.coveredPersonIds == ["person-001", "person-002"]
    assert first.walkingDistancesMeters == {
        "person-001": 0.0,
        "person-002": 400.0,
    }
    assert first.qualityScore == 1.0
    assert first.averageWalkingDistanceMeters == 200.0

    second = evaluations[1]
    assert second.coveredPersonIds == ["person-002"]
    assert second.qualityScore == 0.5
    assert second.averageWalkingDistanceMeters == 0.0


def test_distance_at_500_is_covered_but_none_and_above_500_are_not() -> None:
    persons = [
        Person(id="person-001", location=(32.8500, 39.9300)),
        Person(id="person-002", location=(32.8600, 39.9400)),
        Person(id="person-003", location=(32.8700, 39.9500)),
    ]
    candidate = StopCandidate(
        id="stop-candidate-001",
        location=(32.8500, 39.9300),
    )

    evaluation = evaluate_candidates(
        persons=persons,
        candidates=[candidate],
        distance_matrix=[[500.0], [500.1], [None]],
        max_walking_distance_meters=500,
    )[0]

    assert evaluation.coveredPersonIds == ["person-001"]
    assert evaluation.qualityScore == pytest.approx(1 / 3)


def test_people_at_same_location_are_counted_separately() -> None:
    persons = [
        Person(id="person-001", location=(32.8500, 39.9300)),
        Person(id="person-002", location=(32.8500, 39.9300)),
    ]
    candidate = StopCandidate(
        id="stop-candidate-001",
        location=(32.8500, 39.9300),
    )

    evaluation = evaluate_candidates(
        persons=persons,
        candidates=[candidate],
        distance_matrix=[[0.0], [0.0]],
        max_walking_distance_meters=500,
    )[0]

    assert evaluation.coveredPersonIds == ["person-001", "person-002"]
    assert evaluation.qualityScore == 1.0


def test_analysis_connects_candidates_to_osrm_matrix() -> None:
    persons = [
        Person(id="person-001", location=(32.8500, 39.9300)),
        Person(id="person-002", location=(32.8600, 39.9400)),
    ]
    osrm = AsyncMock(spec=OsrmFootClient)
    osrm.get_distance_matrix.return_value = [
        [0.0, 600.0],
        [400.0, 0.0],
    ]

    evaluations = asyncio.run(
        analyze_stop_candidates(
            persons=persons,
            max_walking_distance_meters=500,
            osrm=osrm,
        )
    )

    assert len(evaluations) == 2
    osrm.get_distance_matrix.assert_awaited_once()


def test_invalid_matrix_shape_is_rejected() -> None:
    persons = [Person(id="person-001", location=(32.8500, 39.9300))]
    candidate = StopCandidate(
        id="stop-candidate-001",
        location=(32.8500, 39.9300),
    )

    with pytest.raises(OsrmError, match="personel satır sayısı"):
        evaluate_candidates(
            persons=persons,
            candidates=[candidate],
            distance_matrix=[],
            max_walking_distance_meters=500,
        )


def test_invalid_matrix_column_count_is_rejected() -> None:
    persons = [Person(id="person-001", location=(32.8500, 39.9300))]
    candidate = StopCandidate(
        id="stop-candidate-001",
        location=(32.8500, 39.9300),
    )

    with pytest.raises(OsrmError, match="durak adayı sütun sayısı"):
        evaluate_candidates(
            persons=persons,
            candidates=[candidate],
            distance_matrix=[[]],
            max_walking_distance_meters=500,
        )


@pytest.mark.parametrize("invalid_distance", [-1.0, "yüz metre"])
def test_invalid_matrix_distance_is_rejected(invalid_distance: object) -> None:
    persons = [Person(id="person-001", location=(32.8500, 39.9300))]
    candidate = StopCandidate(
        id="stop-candidate-001",
        location=(32.8500, 39.9300),
    )

    with pytest.raises(OsrmError, match="geçersiz bir mesafe"):
        evaluate_candidates(
            persons=persons,
            candidates=[candidate],
            distance_matrix=[[invalid_distance]],  # type: ignore[list-item]
            max_walking_distance_meters=500,
        )
