import os
from typing import Any

import httpx2

Coordinate = tuple[float, float]

# 1 derece enlem ~111.32 km; bu sabit metre->derece dönüşümü için kullanılır.
_METERS_PER_DEGREE_LATITUDE = 111_320.0


class OverpassClient:
    """Bir noktanın çevresindeki ana/toplayıcı yolları (Cadde/Bulvar) bulur.

    Halka açık Overpass API yerine kendi özel Nominatim sunucumuzu kullanır:
    yerel olduğu için hızlıdır, dış servise bağımlılık ve hız sınırı yoktur,
    ve zaten adres geocoding için kurulu olan altyapıyı tekrar kullanır.
    Sınıf adı geriye uyumluluk için "OverpassClient" bırakıldı.
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
        client: httpx2.AsyncClient | None = None,
    ) -> None:
        configured = base_url or os.getenv("NOMINATIM_URL") or "http://nominatim:8080"
        self.base_url = configured.rstrip("/")
        self.timeout_seconds = timeout_seconds or float(os.getenv("NOMINATIM_TIMEOUT_SECONDS", "10"))
        self.client = client

    async def find_main_roads_near(
        self,
        location: Coordinate,
        radius_meters: float = 600.0,
        limit: int = 20,
    ) -> list[tuple[Coordinate, str]]:
        """(koordinat, OSM highway sınıfı) çiftleri döndürür.

        Sınıf bilgisi, candidates.py'nin sadece en yakını değil en yakın
        *büyük* yolu seçmesini sağlar: "Cadde" adı taşısa bile bir site içi
        dar erişim yolu (residential) ile gerçek bir toplayıcı/ana yol
        (tertiary/secondary/primary) aynı ada sayılmamalı.
        """
        longitude, latitude = location
        degree_delta = radius_meters / _METERS_PER_DEGREE_LATITUDE
        # Nominatim viewbox: sol,üst,sağ,alt (lon_min,lat_max,lon_max,lat_min)
        viewbox = (
            f"{longitude - degree_delta},{latitude + degree_delta},"
            f"{longitude + degree_delta},{latitude - degree_delta}"
        )
        # Nominatim sonuçları öneme göre sıralar, mesafeye göre değil; bu yüzden
        # her iki kelimeyi de arayıp tüm adayları toplarız — gerçek seçim
        # (candidates.py'deki _best_within) mesafe + yol sınıfına göre yapılır.
        cadde_results = await self._search("Cadde", viewbox, limit)
        bulvar_results = await self._search("Bulvar", viewbox, limit)

        points: list[tuple[Coordinate, str]] = []
        for item in [*cadde_results, *bulvar_results]:
            name = str(item.get("display_name") or "")
            if "cadde" not in name.lower() and "bulvar" not in name.lower():
                continue
            try:
                coordinate = (float(item["lon"]), float(item["lat"]))
            except (KeyError, TypeError, ValueError):
                continue
            # jsonv2'de highway kategorisi öğelerinde "type" OSM'in highway
            # alt-etiketidir (residential/tertiary/secondary/primary...).
            road_class = str(item.get("type") or "unclassified")
            points.append((coordinate, road_class))
        return points

    async def _search(self, query: str, viewbox: str, limit: int) -> list[dict[str, Any]]:
        params = {
            "format": "jsonv2",
            "limit": str(limit),
            "countrycodes": "tr",
            "bounded": "1",
            "viewbox": viewbox,
            "q": query,
        }
        url = f"{self.base_url}/search"
        try:
            if self.client is not None:
                response = await self.client.get(url, params=params, timeout=self.timeout_seconds)
            else:
                async with httpx2.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
            return payload if isinstance(payload, list) else []
        except (httpx2.RequestError, httpx2.HTTPStatusError, ValueError, TypeError):
            # Nominatim'e ulaşılamazsa durak üretimi tamamen başarısız olmamalı;
            # çağıran taraf OSRM en-yakın-nokta yöntemine düşer.
            return []
