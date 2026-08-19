from collections import defaultdict
from math import asin, cos, floor, radians, sin, sqrt

from app.models import Person, StopCandidate
from app.osrm import Coordinate, OsrmFootClient
from app.overpass import OverpassClient


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
    overpass: OverpassClient | None = None,
    max_walking_distance_meters: float = 500.0,
    minimum_spacing_meters: float = 100.0,
) -> list[StopCandidate]:
    seed_locations = generate_candidate_seed_locations(persons)
    if not seed_locations:
        return []

    resolved: list[Coordinate | None] = [None] * len(seed_locations)
    fallback_indices: list[int] = []

    if overpass is not None:
        for index, seed in enumerate(seed_locations):
            main_road_points = await overpass.find_main_roads_near(
                seed, radius_meters=max_walking_distance_meters + 100.0
            )
            best = _best_within(seed, main_road_points, max_walking_distance_meters)
            if best is not None:
                resolved[index] = best
            else:
                fallback_indices.append(index)
    else:
        fallback_indices = list(range(len(seed_locations)))

    if fallback_indices:
        fallback_seeds = [seed_locations[index] for index in fallback_indices]
        snapped = await osrm.snap_locations(fallback_seeds)
        for index, location in zip(fallback_indices, snapped):
            resolved[index] = location

    accepted: list[Coordinate] = []
    for location in sorted({item for item in resolved if item is not None}):
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


# Düşük değer = tercih edilir. "Cadde"/"Bulvar" adı taşısa da bir site içi
# erişim yolu OSM'de genelde residential/living_street/service olarak
# etiketlidir; yürüme mesafesi içindeyse bile gerçek toplayıcı/ana yol varsa
# onu tercih ederiz — servis aracı site içine değil ana yola çeker.
_ROAD_CLASS_RANK = {
    "trunk": 0,
    "primary": 1,
    "secondary": 2,
    "tertiary": 3,
    "unclassified": 4,
    "residential": 5,
    "living_street": 6,
    "service": 7,
}
_DEFAULT_ROAD_CLASS_RANK = 8


def _best_within(
    origin: Coordinate, points: list[tuple[Coordinate, str]], max_meters: float
) -> Coordinate | None:
    reachable = [
        (location, road_class, distance)
        for location, road_class in points
        if (distance := _straight_line_distance_meters(origin, location)) <= max_meters
    ]
    if not reachable:
        return None
    best_location, _, _ = min(
        reachable,
        key=lambda item: (_ROAD_CLASS_RANK.get(item[1], _DEFAULT_ROAD_CLASS_RANK), item[2]),
    )
    return best_location


def _straight_line_distance_meters(first: Coordinate, second: Coordinate) -> float:
    first_lon, first_lat = map(radians, first)
    second_lon, second_lat = map(radians, second)
    latitude_delta = second_lat - first_lat
    longitude_delta = second_lon - first_lon
    value = sin(latitude_delta / 2) ** 2 + (
        cos(first_lat) * cos(second_lat) * sin(longitude_delta / 2) ** 2
    )
    return 2 * 6_371_000 * asin(sqrt(value))
