from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Servis Durak Optimizasyon API", version="0.1.0")


class Person(BaseModel):
    id: str
    location: list[float] = Field(min_length=2, max_length=2)


class StopGenerationRequest(BaseModel):
    persons: list[Person]
    maxWalkingDistanceMeters: int = Field(default=500, frozen=True)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "optimization"}


@app.post("/api/v1/stops/generate")
def generate_stops(request: StopGenerationRequest) -> dict:
    """Faz 1 sözleşme ucu; Faz 2'de foot-OSRM doğrulamalı algoritma eklenecek."""
    return {
        "stops": [],
        "unassignedPersonIds": [person.id for person in request.persons],
    }
