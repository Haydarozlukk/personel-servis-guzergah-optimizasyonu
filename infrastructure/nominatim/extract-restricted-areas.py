#!/usr/bin/env python3
"""restricted-areas.geojson dosyasını OSM verisinden yeniden üretir.

Bakım aracıdır, Compose akışının parçası değildir: harita verisi yenilendiğinde
veya kapsam değiştiğinde elle çalıştırılır. Ürettiği dosyayı hem OSRM maskelemesi
(mask-restricted-areas.py) hem de backend'in rota denetimi okur.

    docker compose run --rm --entrypoint extract-restricted-areas map-prepare \
        /map/ankara.osm.pbf /config/restricted-areas.geojson
"""

import json
import re
import sys

import osmium

# Ankara büyükşehir yaklaşık kapsamı: minLon, minLat, maxLon, maxLat. Ankara
# extract'i Bolu ve Kırşehir'e kadar uzandığı için servis bölgesi dışındaki
# alanlar bu kutuyla elenir.
BBOX = (32.20, 39.50, 33.30, 40.30)

# Askeri etiket taşısa da servis rotalarına kapatılmaması gerekenler:
# personelin çalıştığı savunma sanayi yerleşkeleri ile halka açık tesisler.
EXCLUDED_NAME_PATTERNS = re.compile(
    r"aselsan|tübitak|tubitak|roketsan|mke |mke$|makina ve kimya"
    r"|anıtkabir|anitkabir|orduevi|havaalanı|havaalani|heliport|sosyal tesis",
    re.IGNORECASE,
)

TURKISH_SLUG_MAP = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosucgiosu")


def is_restricted(tags):
    if tags.get("landuse") == "military" or tags.get("military"):
        return True
    return tags.get("amenity") == "university"


def slugify(name):
    slug = name.translate(TURKISH_SLUG_MAP).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return slug or "isimsiz"


def ring_coordinates(ring):
    points = [[round(point.lon, 7), round(point.lat, 7)] for point in ring]
    if points[0] != points[-1]:
        points.append(points[0])
    return points


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.features = []
        self.skipped = []
        self.used_ids = {}

    def area(self, area):
        tags = area.tags
        if not is_restricted(tags):
            return

        name = tags.get("name")
        if not name:
            return

        polygons = []
        for outer in area.outer_rings():
            rings = [ring_coordinates(outer)]
            rings.extend(ring_coordinates(inner) for inner in area.inner_rings(outer))
            polygons.append(rings)

        if not polygons:
            return

        longitudes = [x for polygon in polygons for ring in polygon for x, _ in ring]
        latitudes = [y for polygon in polygons for ring in polygon for _, y in ring]
        # Kesişim testi kullanılır: sınırda oturan bir yerleşkenin ağırlık
        # merkezi kutunun dışına düşse de alan kapsama girer.
        if max(longitudes) < BBOX[0] or min(longitudes) > BBOX[2]:
            return
        if max(latitudes) < BBOX[1] or min(latitudes) > BBOX[3]:
            return

        if EXCLUDED_NAME_PATTERNS.search(name):
            self.skipped.append(name)
            return

        # Area kimliği ways için 2n, relationlar için 2n+1 üretilir.
        osm_id = area.id // 2
        osm_type = "way" if area.from_way() else "relation"

        identifier = slugify(name)
        self.used_ids[identifier] = self.used_ids.get(identifier, 0) + 1
        if self.used_ids[identifier] > 1:
            identifier = f"{identifier}-{osm_id}"

        geometry = (
            {"type": "Polygon", "coordinates": polygons[0]}
            if len(polygons) == 1
            else {"type": "MultiPolygon", "coordinates": polygons}
        )
        self.features.append({
            "type": "Feature",
            "properties": {
                "id": identifier,
                "name": name,
                "source": f"OSM {osm_type}/{osm_id}",
            },
            "geometry": geometry,
        })


def write_geojson(features, path):
    def ring_text(ring):
        return "[" + ", ".join(f"[{x}, {y}]" for x, y in ring) + "]"

    def geometry_text(geometry, indent):
        pad = " " * indent
        if geometry["type"] == "Polygon":
            rings = ",\n".join(f"{pad}  {ring_text(r)}" for r in geometry["coordinates"])
            return f'{{\n{pad}"type": "Polygon",\n{pad}"coordinates": [\n{rings}\n{pad}]\n{" " * (indent - 2)}}}'
        polygons = ",\n".join(
            f"{pad}  [\n"
            + ",\n".join(f"{pad}    {ring_text(r)}" for r in polygon)
            + f"\n{pad}  ]"
            for polygon in geometry["coordinates"]
        )
        return f'{{\n{pad}"type": "MultiPolygon",\n{pad}"coordinates": [\n{polygons}\n{pad}]\n{" " * (indent - 2)}}}'

    blocks = []
    for feature in features:
        properties = feature["properties"]
        blocks.append(
            '    {\n      "type": "Feature",\n      "properties": {\n'
            f'        "id": {json.dumps(properties["id"], ensure_ascii=False)},\n'
            f'        "name": {json.dumps(properties["name"], ensure_ascii=False)},\n'
            f'        "source": {json.dumps(properties["source"], ensure_ascii=False)}\n'
            "      },\n"
            f'      "geometry": {geometry_text(feature["geometry"], 8)}\n'
            "    }"
        )

    header = (
        '{\n  "type": "FeatureCollection",\n'
        '  "//": "Servis rotalarina kapali alanlar. Kaynak: OpenStreetMap. '
        'extract-restricted-areas.py ile uretilir; elle de duzenlenebilir. '
        'Poligonlar WGS84 [lon, lat] sirasindadir.",\n'
        '  "features": [\n'
    )
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(header + ",\n".join(blocks) + "\n  ]\n}\n")


def main():
    if len(sys.argv) != 3:
        print("kullanım: extract-restricted-areas.py <girdi.pbf> <cikti.geojson>", file=sys.stderr)
        return 2

    source, destination = sys.argv[1:3]
    collector = Collector()
    collector.apply_file(source, locations=True, idx="flex_mem")

    collector.features.sort(key=lambda feature: feature["properties"]["id"])
    write_geojson(collector.features, destination)

    print(f"{len(collector.features)} kapalı alan yazıldı: {destination}")
    if collector.skipped:
        print(f"Kapsam dışı bırakılan {len(collector.skipped)} alan: {', '.join(sorted(set(collector.skipped)))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
