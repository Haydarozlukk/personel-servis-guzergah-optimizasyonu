import os

import httpx2


Coordinate = tuple[float, float]


class OsrmError(RuntimeError):
    """OSRM isteği tamamlanamadığında oluşan uygulama hatası."""


class OsrmFootClient:
    def __init__(
        self,
        base_url: str | None = None,
        timeout_seconds: float = 10.0,
        client: httpx2.AsyncClient | None = None,
    ) -> None:
        self.base_url = (
            base_url or os.getenv("OSRM_FOOT_URL", "http://osrm-foot:5000")
        ).rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.client = client

    async def get_distance_matrix(
        self,
        sources: list[Coordinate],
        destinations: list[Coordinate],
    ) -> list[list[float | None]]:
        if not sources:
            return []

        if not destinations:
            return [[] for _ in sources]

        coordinates = sources + destinations
        coordinate_path = ";".join(
            f"{longitude},{latitude}" for longitude, latitude in coordinates
        )
        source_indexes = ";".join(str(index) for index in range(len(sources)))
        destination_indexes = ";".join(
            str(index)
            for index in range(len(sources), len(coordinates))
        )

        url = f"{self.base_url}/table/v1/foot/{coordinate_path}"
        params = {
            "annotations": "distance",
            "sources": source_indexes,
            "destinations": destination_indexes,
        }

        try:
            if self.client is not None:
                response = await self.client.get(url, params=params)
            else:
                async with httpx2.AsyncClient(
                    timeout=self.timeout_seconds,
                ) as client:
                    response = await client.get(url, params=params)

            response.raise_for_status()
        except httpx2.RequestError as error:
            raise OsrmError("OSRM foot servisine ulaşılamadı.") from error
        except httpx2.HTTPStatusError as error:
            raise OsrmError(
                f"OSRM foot servisi {error.response.status_code} hatası döndürdü."
            ) from error

        try:
            payload = response.json()
        except ValueError as error:
            raise OsrmError("OSRM foot servisi geçersiz JSON döndürdü.") from error

        distances = payload.get("distances")

        if payload.get("code") != "Ok" or not isinstance(distances, list):
            raise OsrmError("OSRM foot servisi geçersiz bir cevap döndürdü.")

        return distances
