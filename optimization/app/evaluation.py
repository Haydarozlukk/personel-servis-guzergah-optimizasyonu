from dataclasses import dataclass

from app.candidates import generate_stop_candidates
from app.models import CandidateEvaluation, Person, StopCandidate, UnassignedReason
from app.osrm import OsrmError, OsrmFootClient
from app.overpass import OverpassClient


@dataclass(frozen=True)
class CandidateAnalysis:
    evaluations: list[CandidateEvaluation]
    initial_unassigned_reasons: dict[str, UnassignedReason]
    matrix_chunk_count: int


def evaluate_candidates(
    persons: list[Person],
    candidates: list[StopCandidate],
    distance_matrix: list[list[float | None]],
    max_walking_distance_meters: int,
    duration_matrix: list[list[float | None]] | None = None,
) -> list[CandidateEvaluation]:
    _validate_matrix_shape(persons, candidates, distance_matrix, "mesafe")
    if duration_matrix is None:
        duration_matrix = [[None for _ in candidates] for _ in persons]
    _validate_matrix_shape(persons, candidates, duration_matrix, "süre")
    if not persons:
        return []

    evaluations: list[CandidateEvaluation] = []
    for candidate_index, candidate in enumerate(candidates):
        walking_distances: dict[str, float] = {}
        walking_durations: dict[str, float] = {}
        for person_index, person in enumerate(persons):
            distance = distance_matrix[person_index][candidate_index]
            if distance is not None and distance <= max_walking_distance_meters:
                walking_distances[person.id] = float(distance)
                duration = duration_matrix[person_index][candidate_index]
                if duration is not None:
                    walking_durations[person.id] = float(duration)

        count = len(walking_distances)
        evaluations.append(CandidateEvaluation(
            candidate=candidate,
            coveredPersonIds=list(walking_distances),
            walkingDistancesMeters=walking_distances,
            walkingDurationsSeconds=walking_durations,
            qualityScore=count / len(persons),
            averageWalkingDistanceMeters=sum(walking_distances.values()) / count if count else None,
        ))
    return evaluations


async def analyze_stop_candidates(
    persons: list[Person],
    max_walking_distance_meters: int,
    osrm: OsrmFootClient,
    overpass: OverpassClient | None = None,
) -> CandidateAnalysis:
    candidates = await generate_stop_candidates(
        persons, osrm, overpass=overpass, max_walking_distance_meters=max_walking_distance_meters
    )
    matrix = await osrm.get_walking_matrix(
        sources=[person.location for person in persons],
        destinations=[candidate.location for candidate in candidates],
    )
    evaluations = evaluate_candidates(
        persons, candidates, matrix.distances, max_walking_distance_meters, matrix.durations
    )
    initial_reasons: dict[str, UnassignedReason] = {}
    for person_index, person in enumerate(persons):
        row = matrix.distances[person_index]
        if any(distance is not None and distance <= max_walking_distance_meters for distance in row):
            continue
        initial_reasons[person.id] = (
            "no_route" if not row or all(distance is None for distance in row)
            else "no_candidate_within_limit"
        )
    return CandidateAnalysis(evaluations, initial_reasons, matrix.chunk_count)


def _validate_matrix_shape(
    persons: list[Person], candidates: list[StopCandidate], matrix: list[list[float | None]], name: str
) -> None:
    if len(matrix) != len(persons):
        raise OsrmError(f"OSRM {name} matrisinin personel satır sayısı geçersiz.")
    if any(not isinstance(row, list) or len(row) != len(candidates) for row in matrix):
        raise OsrmError(f"OSRM {name} matrisinin durak adayı sütun sayısı geçersiz.")
    if any(value is not None and (not isinstance(value, (int, float)) or value < 0) for row in matrix for value in row):
        raise OsrmError(f"OSRM {name} matrisi geçersiz bir değer içeriyor.")
