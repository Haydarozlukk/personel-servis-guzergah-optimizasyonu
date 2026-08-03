from collections import defaultdict
from math import asin, cos, floor, radians, sin, sqrt

from app.models import Person, StopCandidate
from app.osrm import Coordinate, OsrmFootClient


def generate_candidate_seed_locations(
    persons: list[Person],
    grid_size_meters: float = 150.0,
) -> list[Coordinate]:
    """Kişileri yaklaşık 200 m hücrelerde gruplayıp hücre merkezlerini üretir."""
    if not persons:
        return []

    mean_latitude = sum(person.location[1] for person in persons) / len(persons)
    latitude_step = grid_size_meters / 111_320
    longitude_step = grid_size_meters / (
        111_320 * max(cos(radians(mean_latitude)), 0.01)
    )
    cells: dict[tuple[int, int], list[Coordinate]] = defaultdict(list)

    for person in persons:
        longitude, latitude = person.location
        cell = (floor(longitude / longitude_step), floor(latitude / latitude_step))
        cells[cell].append(person.location)

    return [
        (
            (cell[0] + 0.5) * longitude_step,
            (cell[1] + 0.5) * latitude_step,
        )
        for cell in sorted(cells)
    ]


async def generate_stop_candidates(
    persons: list[Person],
    osrm: OsrmFootClient,
    minimum_spacing_meters: float = 100.0,
) -> list[StopCandidate]:
    seed_locations = generate_candidate_seed_locations(persons)
    snapped_locations = await osrm.snap_locations(seed_locations)
    accepted: list[Coordinate] = []

    for location in sorted({item for item in snapped_locations if item is not None}):
        if all(
            _straight_line_distance_meters(location, existing)
            >= minimum_spacing_meters
            for existing in accepted
        ):
            accepted.append(location)

    return [
        StopCandidate(id=f"stop-candidate-{index:03d}", location=location)
        for index, location in enumerate(accepted, start=1)
    ]


def _straight_line_distance_meters(first: Coordinate, second: Coordinate) -> float:
    first_lon, first_lat = map(radians, first)
    second_lon, second_lat = map(radians, second)
    latitude_delta = second_lat - first_lat
    longitude_delta = second_lon - first_lon
    value = sin(latitude_delta / 2) ** 2 + (
        cos(first_lat) * cos(second_lat) * sin(longitude_delta / 2) ** 2
    )
    return 2 * 6_371_000 * asin(sqrt(value))
