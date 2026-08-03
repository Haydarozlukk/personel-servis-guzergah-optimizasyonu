from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

from app.assignment import select_stops_and_assign_persons
from app.evaluation import analyze_stop_candidates
from app.models import StopGenerationRequest, StopGenerationResult
from app.osrm import OsrmError, OsrmFootClient

app = FastAPI(
    title="Servis Durak Optimizasyon API",
    version="0.1.0",
)


def get_osrm_client() -> OsrmFootClient:
    return OsrmFootClient()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "optimization"}


@app.post(
    "/api/v1/stops/generate",
    response_model=StopGenerationResult,
)
async def generate_stops(
    request: StopGenerationRequest,
    osrm: Annotated[OsrmFootClient, Depends(get_osrm_client)],
) -> StopGenerationResult:
    try:
        evaluations = await analyze_stop_candidates(
            persons=request.persons,
            max_walking_distance_meters=request.maxWalkingDistanceMeters,
            osrm=osrm,
        )
    except OsrmError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return select_stops_and_assign_persons(request.persons, evaluations)
