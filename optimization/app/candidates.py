from app.models import Person, StopCandidate


def generate_stop_candidates(persons: list[Person]) -> list[StopCandidate]:
    unique_locations = sorted({person.location for person in persons})

    return [
        StopCandidate(
            id=f"stop-candidate-{index:03d}",
            location=location,
        )
        for index, location in enumerate(unique_locations, start=1)
    ]
