import asyncio
import os

import pytest

from app.osrm import OsrmFootClient


@pytest.mark.skipif(
    os.getenv("RUN_OSRM_INTEGRATION") != "1",
    reason="Gerçek OSRM entegrasyonu yalnızca açıkça istendiğinde çalıştırılır.",
)
def test_real_osrm_foot_returns_a_walking_distance() -> None:
    osrm = OsrmFootClient(
        base_url=os.getenv("OSRM_FOOT_URL", "http://localhost:5001")
    )

    distances = asyncio.run(
        osrm.get_distance_matrix(
            sources=[(32.8597, 39.9334)],
            destinations=[(32.8642, 39.9261)],
        )
    )

    assert len(distances) == 1
    assert len(distances[0]) == 1
    assert distances[0][0] is not None
    assert distances[0][0] >= 0
