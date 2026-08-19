import asyncio
import os
from dataclasses import dataclass
from typing import Any

import httpx2

Coordinate = tuple[float, float]


class OsrmError(RuntimeError):
    """OSRM isteği tamamlanamadığında oluşan uygulama hatası."""


# Türkçe adreslendirmede yol hiyerarşisi neredeyse her zaman isimden anlaşılır:
# Bulvar/Cadde ana/toplayıcı yol, Sokak ise dar mahalle içi yoldur. Servis
# aracının mahalleye girmemesi için durağı mümkünse bir Bulvar/Cadde üzerinde,
# yolcuyu da oraya yürütecek şekilde seçeriz.
_MAIN_ROAD_MARKERS = ("bulvar", "cadde", "caddesi", "cad.", "cad ")


def _pick_main_road_waypoint(waypoints: list[dict[str, Any]]) -> dict[str, Any] | None:
    for waypoint in waypoints:
        name = str(waypoint.get("name") or "").lower()
        if any(marker in name for marker in _MAIN_ROAD_MARKERS):
            return waypoint
    return waypoints[0] if waypoints else None


@dataclass(frozen=True)
class WalkingMatrix:
    distances: list[list[float | None]]
    durations: list[list[float | None]]
    chunk_count: int


class OsrmFootClient:
    def __init__(
        self,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        client: httpx2.AsyncClient | None = None,
        table_coordinate_limit: int | None = None,
        concurrency: int | None = None,
        retry_count: int | None = None,
    ) -> None:
        configured_base_url = base_url or os.getenv("OSRM_FOOT_URL") or "http://osrm-foot:5000"
        self.base_url = configured_base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds or float(os.getenv("OSRM_TIMEOUT_SECONDS", "10"))
        self.table_coordinate_limit = table_coordinate_limit or int(os.getenv("OSRM_TABLE_COORDINATE_LIMIT", "100"))
        self.concurrency = concurrency or int(os.getenv("OSRM_MAX_CONCURRENCY", "4"))
        self.retry_count = retry_count if retry_count is not None else int(os.getenv("OSRM_RETRY_COUNT", "2"))
        self.client = client

    async def snap_locations(self, locations: list[Coordinate]) -> list[Coordinate | None]:
        semaphore = asyncio.Semaphore(self.concurrency)

        async def snap(location: Coordinate) -> Coordinate | None:
            longitude, latitude = location
            async with semaphore:
                payload = await self._get_json(
                    f"{self.base_url}/nearest/v1/foot/{longitude},{latitude}",
                    {"number": "10"},
                )
            waypoints = payload.get("waypoints")
            if payload.get("code") != "Ok" or not isinstance(waypoints, list) or not waypoints:
                return None
            best = _pick_main_road_waypoint(waypoints)
            if best is None:
                return None
            snapped = best.get("location")
            if not isinstance(snapped, list) or len(snapped) != 2:
                return None
            return float(snapped[0]), float(snapped[1])

        return list(await asyncio.gather(*(snap(location) for location in locations)))

    async def get_walking_matrix(
        self,
        sources: list[Coordinate],
        destinations: list[Coordinate],
    ) -> WalkingMatrix:
        if not sources:
            return WalkingMatrix([], [], 0)
        if not destinations:
            empty: list[list[float | None]] = [[] for _ in sources]
            return WalkingMatrix(empty, [[] for _ in sources], 0)

        block_size = max(1, self.table_coordinate_limit // 2)
        source_blocks = [sources[i:i + block_size] for i in range(0, len(sources), block_size)]
        destination_blocks = [destinations[i:i + block_size] for i in range(0, len(destinations), block_size)]
        distances: list[list[float | None]] = [
            [None for _ in destinations] for _ in sources
        ]
        durations: list[list[float | None]] = [
            [None for _ in destinations] for _ in sources
        ]
        semaphore = asyncio.Semaphore(self.concurrency)

        async def fetch(source_index: int, destination_index: int) -> tuple[int, int, dict[str, Any]]:
            async with semaphore:
                payload = await self._get_table_chunk(
                    source_blocks[source_index], destination_blocks[destination_index]
                )
            return source_index, destination_index, payload

        tasks = [
            fetch(source_index, destination_index)
            for source_index in range(len(source_blocks))
            for destination_index in range(len(destination_blocks))
        ]
        results = await asyncio.gather(*tasks)

        for source_index, destination_index, payload in results:
            source_offset = source_index * block_size
            destination_offset = destination_index * block_size
            for row_index, row in enumerate(payload["distances"]):
                distances[source_offset + row_index][destination_offset:destination_offset + len(row)] = row
            for row_index, row in enumerate(payload["durations"]):
                durations[source_offset + row_index][destination_offset:destination_offset + len(row)] = row

        return WalkingMatrix(distances, durations, len(tasks))

    async def get_distance_matrix(
        self,
        sources: list[Coordinate],
        destinations: list[Coordinate],
    ) -> list[list[float | None]]:
        return (await self.get_walking_matrix(sources, destinations)).distances

    async def _get_table_chunk(self, sources: list[Coordinate], destinations: list[Coordinate]) -> dict[str, Any]:
        coordinates = sources + destinations
        coordinate_path = ";".join(f"{longitude},{latitude}" for longitude, latitude in coordinates)
        payload = await self._get_json(
            f"{self.base_url}/table/v1/foot/{coordinate_path}",
            {
                "annotations": "distance,duration",
                "sources": ";".join(str(index) for index in range(len(sources))),
                "destinations": ";".join(str(index) for index in range(len(sources), len(coordinates))),
            },
        )
        distances = payload.get("distances")
        durations = payload.get("durations")
        if payload.get("code") != "Ok" or not isinstance(distances, list) or not isinstance(durations, list):
            raise OsrmError("OSRM foot servisi geçersiz bir cevap döndürdü.")
        return payload

    async def _get_json(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(self.retry_count + 1):
            try:
                if self.client is not None:
                    response = await self.client.get(url, params=params)
                else:
                    async with httpx2.AsyncClient(timeout=self.timeout_seconds) as client:
                        response = await client.get(url, params=params)
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise TypeError("JSON nesnesi bekleniyordu")
                return payload
            except (httpx2.RequestError, httpx2.HTTPStatusError, ValueError, TypeError) as error:
                last_error = error
                retryable = isinstance(error, httpx2.RequestError) or (
                    isinstance(error, httpx2.HTTPStatusError) and error.response.status_code >= 500
                )
                if not retryable or attempt == self.retry_count:
                    break
                await asyncio.sleep(0.1 * 2**attempt)

        if isinstance(last_error, httpx2.HTTPStatusError):
            raise OsrmError(f"OSRM foot servisi {last_error.response.status_code} hatası döndürdü.") from last_error
        if isinstance(last_error, (ValueError, TypeError)):
            raise OsrmError("OSRM foot servisi geçersiz JSON döndürdü.") from last_error
        raise OsrmError("OSRM foot servisine ulaşılamadı.") from last_error
