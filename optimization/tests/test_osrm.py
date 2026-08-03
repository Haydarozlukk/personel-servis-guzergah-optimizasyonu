import asyncio

import httpx2
import pytest

from app.osrm import OsrmError, OsrmFootClient


def test_distance_matrix_returns_osrm_distances() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path.startswith("/table/v1/foot/")
        assert request.url.params["annotations"] == "distance"
        assert request.url.params["sources"] == "0;1"
        assert request.url.params["destinations"] == "2"
        return httpx2.Response(
            200,
            json={
                "code": "Ok",
                "distances": [[125.4], [501.2]],
            },
        )

    async def run_test() -> list[list[float | None]]:
        transport = httpx2.MockTransport(handler)
        async with httpx2.AsyncClient(transport=transport) as client:
            osrm = OsrmFootClient(
                base_url="http://osrm-foot:5000",
                client=client,
            )
            return await osrm.get_distance_matrix(
                sources=[(32.8597, 39.9334), (32.8642, 39.9261)],
                destinations=[(32.8505, 39.9412)],
            )

    assert asyncio.run(run_test()) == [[125.4], [501.2]]


def test_empty_sources_return_an_empty_matrix() -> None:
    osrm = OsrmFootClient(base_url="http://osrm-foot:5000")

    assert asyncio.run(osrm.get_distance_matrix([], [])) == []


def test_empty_destinations_return_one_empty_row_per_source() -> None:
    osrm = OsrmFootClient(base_url="http://osrm-foot:5000")

    distances = asyncio.run(
        osrm.get_distance_matrix(
            sources=[(32.8597, 39.9334), (32.8642, 39.9261)],
            destinations=[],
        )
    )

    assert distances == [[], []]


def test_invalid_osrm_response_raises_application_error() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, json={"code": "InvalidQuery"})

    async def run_test() -> None:
        transport = httpx2.MockTransport(handler)
        async with httpx2.AsyncClient(transport=transport) as client:
            osrm = OsrmFootClient(
                base_url="http://osrm-foot:5000",
                client=client,
            )
            await osrm.get_distance_matrix(
                sources=[(32.8597, 39.9334)],
                destinations=[(32.8505, 39.9412)],
            )

    with pytest.raises(OsrmError, match="geçersiz bir cevap"):
        asyncio.run(run_test())


def test_connection_failure_raises_application_error() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("Bağlantı kurulamadı.", request=request)

    async def run_test() -> None:
        transport = httpx2.MockTransport(handler)
        async with httpx2.AsyncClient(transport=transport) as client:
            osrm = OsrmFootClient(
                base_url="http://osrm-foot:5000",
                client=client,
            )
            await osrm.get_distance_matrix(
                sources=[(32.8597, 39.9334)],
                destinations=[(32.8505, 39.9412)],
            )

    with pytest.raises(OsrmError, match="ulaşılamadı"):
        asyncio.run(run_test())


def test_http_error_includes_osrm_status_code() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(500, json={"code": "Error"})

    async def run_test() -> None:
        transport = httpx2.MockTransport(handler)
        async with httpx2.AsyncClient(transport=transport) as client:
            osrm = OsrmFootClient(
                base_url="http://osrm-foot:5000",
                client=client,
            )
            await osrm.get_distance_matrix(
                sources=[(32.8597, 39.9334)],
                destinations=[(32.8505, 39.9412)],
            )

    with pytest.raises(OsrmError, match="500 hatası"):
        asyncio.run(run_test())


def test_invalid_json_raises_application_error() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, content=b"gecersiz-json")

    async def run_test() -> None:
        transport = httpx2.MockTransport(handler)
        async with httpx2.AsyncClient(transport=transport) as client:
            osrm = OsrmFootClient(
                base_url="http://osrm-foot:5000",
                client=client,
            )
            await osrm.get_distance_matrix(
                sources=[(32.8597, 39.9334)],
                destinations=[(32.8505, 39.9412)],
            )

    with pytest.raises(OsrmError, match="geçersiz JSON"):
        asyncio.run(run_test())
