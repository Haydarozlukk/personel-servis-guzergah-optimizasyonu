from app.models import CandidateEvaluation, Person, Stop, StopGenerationResult


def select_stops_and_assign_persons(
    persons: list[Person],
    evaluations: list[CandidateEvaluation],
) -> StopGenerationResult:
    unassigned_person_ids = {person.id for person in persons}
    selected_stops: list[Stop] = []

    while unassigned_person_ids:
        available_choices = []

        for evaluation in evaluations:
            newly_covered_ids = sorted(
                unassigned_person_ids.intersection(evaluation.coveredPersonIds)
            )

            if not newly_covered_ids:
                continue

            average_distance = sum(
                evaluation.walkingDistancesMeters[person_id]
                for person_id in newly_covered_ids
            ) / len(newly_covered_ids)

            available_choices.append(
                (evaluation, newly_covered_ids, average_distance)
            )

        if not available_choices:
            break

        selected_evaluation, assigned_ids, _ = min(
            available_choices,
            key=lambda choice: (
                -len(choice[1]),
                choice[2],
                choice[0].candidate.id,
            ),
        )

        selected_stops.append(
            Stop(
                id=selected_evaluation.candidate.id,
                location=selected_evaluation.candidate.location,
                assignedPersonIds=assigned_ids,
                walkingDistancesMeters={
                    person_id: selected_evaluation.walkingDistancesMeters[person_id]
                    for person_id in assigned_ids
                },
                demand=len(assigned_ids),
                qualityScore=selected_evaluation.qualityScore,
            )
        )
        unassigned_person_ids.difference_update(assigned_ids)

    return StopGenerationResult(
        stops=selected_stops,
        unassignedPersonIds=sorted(unassigned_person_ids),
    )
