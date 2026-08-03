from app.assignment import select_stops_and_assign_persons
from app.models import CandidateEvaluation, Person, StopCandidate


def make_evaluation(
    candidate_id: str,
    location: tuple[float, float],
    distances: dict[str, float],
    total_person_count: int,
) -> CandidateEvaluation:
    return CandidateEvaluation(
        candidate=StopCandidate(id=candidate_id, location=location),
        coveredPersonIds=list(distances),
        walkingDistancesMeters=distances,
        walkingDurationsSeconds={person_id: distance / 1.4 for person_id, distance in distances.items()},
        qualityScore=len(distances) / total_person_count,
        averageWalkingDistanceMeters=(
            sum(distances.values()) / len(distances) if distances else None
        ),
    )


def test_candidate_covering_most_people_is_selected_first() -> None:
    persons = [
        Person(id="person-001", location=(32.8500, 39.9300)),
        Person(id="person-002", location=(32.8600, 39.9400)),
        Person(id="person-003", location=(32.8700, 39.9500)),
    ]
    evaluations = [
        make_evaluation(
            "stop-candidate-001",
            (32.8500, 39.9300),
            {"person-001": 0.0, "person-002": 300.0},
            3,
        ),
        make_evaluation(
            "stop-candidate-002",
            (32.8600, 39.9400),
            {"person-002": 0.0},
            3,
        ),
        make_evaluation(
            "stop-candidate-003",
            (32.8700, 39.9500),
            {"person-003": 0.0},
            3,
        ),
    ]

    result = select_stops_and_assign_persons(persons, evaluations)

    assert [stop.id for stop in result.stops] == [
        "stop-candidate-001",
        "stop-candidate-003",
    ]
    assert result.stops[0].assignedPersonIds == ["person-001", "person-002"]
    assert result.stops[0].walkingDistancesMeters == {
        "person-001": 0.0,
        "person-002": 300.0,
    }
    assert result.unassignedPersonIds == []


def test_lower_average_distance_breaks_a_coverage_tie() -> None:
    persons = [
        Person(id="person-001", location=(32.8500, 39.9300)),
        Person(id="person-002", location=(32.8600, 39.9400)),
    ]
    evaluations = [
        make_evaluation(
            "stop-candidate-001",
            (32.8500, 39.9300),
            {"person-001": 400.0, "person-002": 400.0},
            2,
        ),
        make_evaluation(
            "stop-candidate-002",
            (32.8600, 39.9400),
            {"person-001": 100.0, "person-002": 200.0},
            2,
        ),
    ]

    result = select_stops_and_assign_persons(persons, evaluations)

    assert len(result.stops) == 1
    assert result.stops[0].id == "stop-candidate-002"


def test_person_is_never_assigned_to_two_stops() -> None:
    persons = [
        Person(id="person-001", location=(32.8500, 39.9300)),
        Person(id="person-002", location=(32.8600, 39.9400)),
    ]
    evaluations = [
        make_evaluation(
            "stop-candidate-001",
            (32.8500, 39.9300),
            {"person-001": 0.0},
            2,
        ),
        make_evaluation(
            "stop-candidate-002",
            (32.8600, 39.9400),
            {"person-001": 100.0, "person-002": 0.0},
            2,
        ),
    ]

    result = select_stops_and_assign_persons(persons, evaluations)
    assigned_ids = [
        person_id
        for stop in result.stops
        for person_id in stop.assignedPersonIds
    ]

    assert assigned_ids.count("person-001") == 1
    assert assigned_ids.count("person-002") == 1
    assert sum(stop.demand for stop in result.stops) == 2


def test_uncovered_people_remain_unassigned() -> None:
    persons = [
        Person(id="person-001", location=(32.8500, 39.9300)),
        Person(id="person-002", location=(32.8600, 39.9400)),
    ]
    evaluations = [
        make_evaluation(
            "stop-candidate-001",
            (32.8500, 39.9300),
            {"person-001": 0.0},
            2,
        )
    ]

    result = select_stops_and_assign_persons(persons, evaluations)

    assert result.stops[0].assignedPersonIds == ["person-001"]
    assert result.unassignedPersonIds == ["person-002"]


def test_candidate_id_breaks_an_exact_tie() -> None:
    persons = [Person(id="person-001", location=(32.8500, 39.9300))]
    evaluations = [
        make_evaluation(
            "stop-candidate-002",
            (32.8600, 39.9400),
            {"person-001": 100.0},
            1,
        ),
        make_evaluation(
            "stop-candidate-001",
            (32.8500, 39.9300),
            {"person-001": 100.0},
            1,
        ),
    ]

    result = select_stops_and_assign_persons(persons, evaluations)

    assert result.stops[0].id == "stop-candidate-001"


def test_stop_demand_never_exceeds_limit_and_overflow_uses_other_stop() -> None:
    persons = [Person(id=f"p{i}", location=(32.85, 39.93)) for i in range(1, 5)]
    evaluations = [
        make_evaluation("s1", (32.85, 39.93), {person.id: float(i) for i, person in enumerate(persons)}, 4),
        make_evaluation("s2", (32.86, 39.94), {person.id: 100.0 + i for i, person in enumerate(persons)}, 4),
    ]
    result = select_stops_and_assign_persons(persons, evaluations, max_stop_demand=2)
    assert [stop.demand for stop in result.stops] == [2, 2]
    assert result.summary.assignedPersonCount == 4
    assert result.unassignedPersonIds == []


def test_capacity_overflow_has_a_reason() -> None:
    persons = [Person(id=f"p{i}", location=(32.85, 39.93)) for i in range(1, 3)]
    evaluations = [make_evaluation("s1", (32.85, 39.93), {"p1": 1.0, "p2": 2.0}, 2)]
    result = select_stops_and_assign_persons(persons, evaluations, max_stop_demand=1)
    assert result.unassignedPersons[0].reason == "stop_capacity_full"
