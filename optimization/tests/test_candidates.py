from app.candidates import generate_stop_candidates
from app.models import Person


def test_each_unique_person_location_becomes_a_candidate() -> None:
    persons = [
        Person(id="person-001", location=(32.8597, 39.9334)),
        Person(id="person-002", location=(32.8642, 39.9261)),
    ]

    candidates = generate_stop_candidates(persons)

    assert len(candidates) == 2
    assert {candidate.location for candidate in candidates} == {
        (32.8597, 39.9334),
        (32.8642, 39.9261),
    }


def test_people_at_the_same_location_share_one_candidate() -> None:
    persons = [
        Person(id="person-001", location=(32.8597, 39.9334)),
        Person(id="person-002", location=(32.8597, 39.9334)),
    ]

    candidates = generate_stop_candidates(persons)

    assert len(candidates) == 1
    assert candidates[0].location == (32.8597, 39.9334)


def test_candidate_output_does_not_depend_on_person_order() -> None:
    first_person = Person(id="person-001", location=(32.8597, 39.9334))
    second_person = Person(id="person-002", location=(32.8642, 39.9261))

    forward = generate_stop_candidates([first_person, second_person])
    reverse = generate_stop_candidates([second_person, first_person])

    assert forward == reverse
    assert [candidate.id for candidate in forward] == [
        "stop-candidate-001",
        "stop-candidate-002",
    ]


def test_empty_person_list_produces_no_candidates() -> None:
    assert generate_stop_candidates([]) == []
