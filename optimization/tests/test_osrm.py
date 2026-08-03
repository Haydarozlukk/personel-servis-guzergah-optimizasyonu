import asyncio

import httpx2
import pytest

from app.osrm import OsrmError, OsrmFootClient


def test_matrix_returns_distance_and_duration() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.params["annotations"] == "distance,duration"
        return httpx2.Response(200, json={
            "code": "Ok", "distances": [[125.4]], "durations": [[89.6]],
        })

    async def run_test():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
            return await OsrmFootClient(client=client).get_walking_matrix([(32.85, 39.93)], [(32.86, 39.94)])

    matrix = asyncio.run(run_test())
    assert matrix.distances == [[125.4]]
    assert matrix.durations == [[89.6]]
    assert matrix.chunk_count == 1


def test_empty_matrix_inputs() -> None:
    osrm = OsrmFootClient()
    assert asyncio.run(osrm.get_distance_matrix([], [])) == []
    assert asyncio.run(osrm.get_distance_matrix([(32.85, 39.93)], [])) == [[]]


def test_nearest_returns_snapped_coordinate() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, json={"code": "Ok", "waypoints": [{"location": [32.851, 39.931]}]})

    async def run_test():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
            return await OsrmFootClient(client=client).snap_locations([(32.85, 39.93)])

    assert asyncio.run(run_test()) == [(32.851, 39.931)]


def test_invalid_osrm_response_raises_application_error() -> None:
    async def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, json={"code": "InvalidQuery"})

    async def run_test():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
            await OsrmFootClient(client=client).get_distance_matrix([(32.85, 39.93)], [(32.86, 39.94)])

    with pytest.raises(OsrmError, match="geçersiz bir cevap"):
        asyncio.run(run_test())


def test_temporary_osrm_error_is_retried() -> None:
    request_count = 0

    async def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal request_count
        request_count += 1
        if request_count == 1:
            return httpx2.Response(503, json={"code": "Error"})
        return httpx2.Response(
            200,
            json={"code": "Ok", "distances": [[10.0]], "durations": [[7.0]]},
        )

    async def run_test():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
            return await OsrmFootClient(client=client, retry_count=1).get_walking_matrix(
                [(32.85, 39.93)], [(32.86, 39.94)]
            )

    assert asyncio.run(run_test()).distances == [[10.0]]
    assert request_count == 2


def test_large_matrix_is_chunked_and_merged() -> None:
    request_count = 0

    async def handler(request: httpx2.Request) -> httpx2.Response:
        nonlocal request_count
        request_count += 1
        source_count = len(request.url.params["sources"].split(";"))
        destination_count = len(request.url.params["destinations"].split(";"))
        return httpx2.Response(200, json={
            "code": "Ok",
            "distances": [[1.0] * destination_count for _ in range(source_count)],
            "durations": [[2.0] * destination_count for _ in range(source_count)],
        })

    async def run_test():
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
            coordinates = [(32.0 + index / 10000, 39.0) for index in range(200)]
            chunked = await OsrmFootClient(
                client=client, table_coordinate_limit=100
            ).get_walking_matrix(coordinates, coordinates)
            single = await OsrmFootClient(
                client=client, table_coordinate_limit=1000
            ).get_walking_matrix(coordinates, coordinates)
            return chunked, single

    matrix, single_matrix = asyncio.run(run_test())
    assert request_count == 17
    assert matrix.chunk_count == 16
    assert len(matrix.distances) == 200
    assert len(matrix.distances[0]) == 200
    assert matrix.durations[199][199] == 2.0
    assert matrix.distances == single_matrix.distances
    assert matrix.durations == single_matrix.durations
