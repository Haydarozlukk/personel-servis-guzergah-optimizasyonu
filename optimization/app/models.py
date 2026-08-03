from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class Person(BaseModel):
    id: str = Field(min_length=1)
    location: tuple[float, float]

    @field_validator("location")
    @classmethod
    def validate_location(cls, location: tuple[float, float]) -> tuple[float, float]:
        longitude, latitude = location
        if not -180 <= longitude <= 180:
            raise ValueError("Boylam -180 ile 180 arasında olmalıdır.")
        if not -90 <= latitude <= 90:
            raise ValueError("Enlem -90 ile 90 arasında olmalıdır.")
        return location


class StopGenerationRequest(BaseModel):
    persons: list[Person] = Field(min_length=1)
    maxWalkingDistanceMeters: int = Field(ge=1, le=500)
    maxStopDemand: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_unique_person_ids(self) -> "StopGenerationRequest":
        person_ids = [person.id for person in self.persons]
        if len(person_ids) != len(set(person_ids)):
            raise ValueError("Personel kimlikleri benzersiz olmalıdır.")
        return self


class StopCandidate(BaseModel):
    id: str
    location: tuple[float, float]


class CandidateEvaluation(BaseModel):
    candidate: StopCandidate
    coveredPersonIds: list[str]
    walkingDistancesMeters: dict[str, float]
    walkingDurationsSeconds: dict[str, float] = Field(default_factory=dict)
    qualityScore: float = Field(ge=0, le=1)
    averageWalkingDistanceMeters: float | None


UnassignedReason = Literal[
    "no_candidate_within_limit",
    "no_route",
    "stop_capacity_full",
]


class UnassignedPerson(BaseModel):
    id: str
    reason: UnassignedReason


class Stop(BaseModel):
    id: str
    location: tuple[float, float]
    assignedPersonIds: list[str]
    walkingDistancesMeters: dict[str, float]
    walkingDurationsSeconds: dict[str, float] = Field(default_factory=dict)
    demand: int = Field(ge=1)
    qualityScore: float = Field(ge=0, le=1)
    averageWalkingDistanceMeters: float


class StopGenerationSummary(BaseModel):
    stopCount: int = Field(ge=0)
    assignedPersonCount: int = Field(ge=0)
    unassignedPersonCount: int = Field(ge=0)
    averageWalkingDistanceMeters: float | None
    maximumWalkingDistanceMeters: float | None
    averageWalkingDurationSeconds: float | None
    maximumWalkingDurationSeconds: float | None
    matrixChunkCount: int = Field(ge=0)


class StopGenerationResult(BaseModel):
    stops: list[Stop]
    unassignedPersonIds: list[str]
    unassignedPersons: list[UnassignedPerson]
    summary: StopGenerationSummary
