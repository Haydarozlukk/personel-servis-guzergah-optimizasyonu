from app.models import (
    CandidateEvaluation,
    Person,
    Stop,
    StopGenerationResult,
    StopGenerationSummary,
    UnassignedPerson,
    UnassignedReason,
)


def select_stops_and_assign_persons(
    persons: list[Person],
    evaluations: list[CandidateEvaluation],
    max_stop_demand: int | None = None,
    initial_unassigned_reasons: dict[str, UnassignedReason] | None = None,
    matrix_chunk_count: int = 0,
) -> StopGenerationResult:
    unassigned_ids = {person.id for person in persons}
    selected_stops: list[Stop] = []
    batch_counts: dict[str, int] = {}

    while unassigned_ids:
        choices: list[tuple[CandidateEvaluation, list[str], float]] = []
        for evaluation in evaluations:
            covered = unassigned_ids.intersection(evaluation.coveredPersonIds)
            ordered = sorted(
                covered,
                key=lambda person_id: (evaluation.walkingDistancesMeters[person_id], person_id),
            )
            if max_stop_demand is not None:
                ordered = ordered[:max_stop_demand]
            if ordered:
                average = sum(evaluation.walkingDistancesMeters[item] for item in ordered) / len(ordered)
                choices.append((evaluation, ordered, average))
        if not choices:
            break

        evaluation, assigned_ids, _ = min(
            choices, key=lambda choice: (-len(choice[1]), choice[2], choice[0].candidate.id)
        )
        batch_number = batch_counts.get(evaluation.candidate.id, 0) + 1
        batch_counts[evaluation.candidate.id] = batch_number
        stop_id = (
            evaluation.candidate.id
            if batch_number == 1
            else f"{evaluation.candidate.id}-batch-{batch_number:03d}"
        )
        distances = {item: evaluation.walkingDistancesMeters[item] for item in assigned_ids}
        durations = {
            item: evaluation.walkingDurationsSeconds[item]
            for item in assigned_ids if item in evaluation.walkingDurationsSeconds
        }
        selected_stops.append(Stop(
            id=stop_id,
            location=evaluation.candidate.location,
            assignedPersonIds=assigned_ids,
            walkingDistancesMeters=distances,
            walkingDurationsSeconds=durations,
            demand=len(assigned_ids),
            qualityScore=len(assigned_ids) / len(persons),
            averageWalkingDistanceMeters=sum(distances.values()) / len(distances),
        ))
        unassigned_ids.difference_update(assigned_ids)

    initial_unassigned_reasons = initial_unassigned_reasons or {}
    details = [
        UnassignedPerson(
            id=person_id,
            reason=initial_unassigned_reasons.get(person_id, "stop_capacity_full"),
        )
        for person_id in sorted(unassigned_ids)
    ]
    all_distances = [distance for stop in selected_stops for distance in stop.walkingDistancesMeters.values()]
    all_durations = [duration for stop in selected_stops for duration in stop.walkingDurationsSeconds.values()]
    return StopGenerationResult(
        stops=selected_stops,
        unassignedPersonIds=[item.id for item in details],
        unassignedPersons=details,
        summary=StopGenerationSummary(
            stopCount=len(selected_stops),
            assignedPersonCount=sum(stop.demand for stop in selected_stops),
            unassignedPersonCount=len(details),
            averageWalkingDistanceMeters=sum(all_distances) / len(all_distances) if all_distances else None,
            maximumWalkingDistanceMeters=max(all_distances) if all_distances else None,
            averageWalkingDurationSeconds=sum(all_durations) / len(all_durations) if all_durations else None,
            maximumWalkingDurationSeconds=max(all_durations) if all_durations else None,
            matrixChunkCount=matrix_chunk_count,
        ),
    )
