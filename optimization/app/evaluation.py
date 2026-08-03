from app.candidates import generate_stop_candidates
from app.models import CandidateEvaluation, Person, StopCandidate
from app.osrm import OsrmError, OsrmFootClient


def evaluate_candidates(
    persons: list[Person],
    candidates: list[StopCandidate],
    distance_matrix: list[list[float | None]],
    max_walking_distance_meters: int,
) -> list[CandidateEvaluation]:
    _validate_matrix_shape(persons, candidates, distance_matrix)

    if not persons:
        return []

    evaluations: list[CandidateEvaluation] = []

    for candidate_index, candidate in enumerate(candidates):
        walking_distances: dict[str, float] = {}

        for person_index, person in enumerate(persons):
            distance = distance_matrix[person_index][candidate_index]

            if distance is not None and distance <= max_walking_distance_meters:
                walking_distances[person.id] = distance

        covered_person_ids = list(walking_distances)
        covered_person_count = len(covered_person_ids)
        average_distance = (
            sum(walking_distances.values()) / covered_person_count
            if covered_person_count
            else None
        )

        evaluations.append(
            CandidateEvaluation(
                candidate=candidate,
                coveredPersonIds=covered_person_ids,
                walkingDistancesMeters=walking_distances,
                qualityScore=covered_person_count / len(persons),
                averageWalkingDistanceMeters=average_distance,
            )
        )

    return evaluations


async def analyze_stop_candidates(
    persons: list[Person],
    max_walking_distance_meters: int,
    osrm: OsrmFootClient,
) -> list[CandidateEvaluation]:
    candidates = generate_stop_candidates(persons)
    distance_matrix = await osrm.get_distance_matrix(
        sources=[person.location for person in persons],
        destinations=[candidate.location for candidate in candidates],
    )

    return evaluate_candidates(
        persons=persons,
        candidates=candidates,
        distance_matrix=distance_matrix,
        max_walking_distance_meters=max_walking_distance_meters,
    )


def _validate_matrix_shape(
    persons: list[Person],
    candidates: list[StopCandidate],
    distance_matrix: list[list[float | None]],
) -> None:
    if len(distance_matrix) != len(persons):
        raise OsrmError("OSRM mesafe matrisinin personel satır sayısı geçersiz.")

    if any(
        not isinstance(row, list) or len(row) != len(candidates)
        for row in distance_matrix
    ):
        raise OsrmError("OSRM mesafe matrisinin durak adayı sütun sayısı geçersiz.")

    if any(
        distance is not None
        and (not isinstance(distance, (int, float)) or distance < 0)
        for row in distance_matrix
        for distance in row
    ):
        raise OsrmError("OSRM mesafe matrisi geçersiz bir mesafe içeriyor.")
