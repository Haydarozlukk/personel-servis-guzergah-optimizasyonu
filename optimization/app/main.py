import json
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Annotated, cast

import httpx2
from fastapi import Depends, FastAPI, HTTPException, Request

from app.assignment import select_stops_and_assign_persons
from app.evaluation import analyze_stop_candidates
from app.models import StopGenerationRequest, StopGenerationResult
from app.osrm import OsrmError, OsrmFootClient
from app.overpass import OverpassClient

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    timeout = float(os.getenv("OSRM_TIMEOUT_SECONDS", "10"))
    client = httpx2.AsyncClient(timeout=timeout)
    app.state.osrm_client = OsrmFootClient(client=client, timeout_seconds=timeout)
    overpass_client = httpx2.AsyncClient()
    app.state.overpass_client = OverpassClient(client=overpass_client)
    try:
        yield
    finally:
        await client.aclose()
        await overpass_client.aclose()


app = FastAPI(title="Servis Durak Optimizasyon API", version="0.2.0", lifespan=lifespan)


def get_osrm_client(request: Request) -> OsrmFootClient:
    return cast(OsrmFootClient, request.app.state.osrm_client)


def get_overpass_client(request: Request) -> OverpassClient:
    return cast(OverpassClient, request.app.state.overpass_client)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "optimization"}


@app.post("/api/v1/stops/generate", response_model=StopGenerationResult)
async def generate_stops(
    request: StopGenerationRequest,
    osrm: Annotated[OsrmFootClient, Depends(get_osrm_client)],
    overpass: Annotated[OverpassClient, Depends(get_overpass_client)],
) -> StopGenerationResult:
    started_at = perf_counter()
    try:
        analysis = await analyze_stop_candidates(
            request.persons, request.maxWalkingDistanceMeters, osrm, overpass
        )
    except OsrmError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    result = select_stops_and_assign_persons(
        request.persons,
        analysis.evaluations,
        request.maxStopDemand,
        analysis.initial_unassigned_reasons,
        analysis.matrix_chunk_count,
    )
    logger.info(json.dumps({
        "event": "stop_generation_completed",
        "personCount": len(request.persons),
        "candidateCount": len(analysis.evaluations),
        "matrixChunkCount": analysis.matrix_chunk_count,
        "durationMilliseconds": round((perf_counter() - started_at) * 1000, 2),
    }))
    return result
