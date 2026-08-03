import pytest
from pydantic import ValidationError

from app.models import Person, StopGenerationRequest


def test_valid_request_is_accepted() -> None:
    request = StopGenerationRequest(
        persons=[
            Person(id="person-001", location=(32.8597, 39.9334)),
        ],
        maxWalkingDistanceMeters=500,
    )

    assert request.maxWalkingDistanceMeters == 500
    assert request.persons[0].id == "person-001"


def test_empty_person_list_is_rejected() -> None:
    with pytest.raises(ValidationError):
        StopGenerationRequest(
            persons=[],
            maxWalkingDistanceMeters=500,
        )


def test_duplicate_person_ids_are_rejected() -> None:
    with pytest.raises(ValidationError):
        StopGenerationRequest(
            persons=[
                Person(id="person-001", location=(32.8597, 39.9334)),
                Person(id="person-001", location=(32.8642, 39.9261)),
            ],
            maxWalkingDistanceMeters=500,
        )


@pytest.mark.parametrize(
    "location",
    [
        (181.0, 39.9334),
        (-181.0, 39.9334),
        (32.8597, 91.0),
        (32.8597, -91.0),
    ],
)
def test_invalid_coordinates_are_rejected(
    location: tuple[float, float],
) -> None:
    with pytest.raises(ValidationError):
        Person(id="person-001", location=location)


@pytest.mark.parametrize("distance", [1, 250, 499, 500])
def test_walking_distance_up_to_500_is_accepted(distance: int) -> None:
    request = StopGenerationRequest(
        persons=[
            Person(id="person-001", location=(32.8597, 39.9334)),
        ],
        maxWalkingDistanceMeters=distance,
    )

    assert request.maxWalkingDistanceMeters == distance


@pytest.mark.parametrize("distance", [0, 501])
def test_walking_distance_outside_limits_is_rejected(distance: int) -> None:
    with pytest.raises(ValidationError):
        StopGenerationRequest(
            persons=[
                Person(id="person-001", location=(32.8597, 39.9334)),
            ],
            maxWalkingDistanceMeters=distance,
        )
