#!/usr/bin/env python3
"""Halka kapalı alanların içindeki yolları access=no ile işaretler.

OSRM'nin varsayılan car/foot profilleri access=no taşıyan yolları graftan
düşürür; böylece kampüs ve askeri bölge içi servis yolları rotalara girmez.
Nominatim aynı alanları isimden bulabilmeye devam etsin diye çıktı ayrı bir
PBF'e yazılır, kaynak dosya değiştirilmez.
"""

import json
import sys

import osmium

# Kapalı alana yalnızca uğrayan ana arterler kamuya açıktır; bunları maskelemek
# şehir trafiğini kesecek kadar geniş bir yan etki yaratır.
THROUGH_HIGHWAY_CLASSES = frozenset(
    {
        "motorway",
        "motorway_link",
        "trunk",
        "trunk_link",
        "primary",
        "primary_link",
        "secondary",
        "secondary_link",
        "tertiary",
        "tertiary_link",
    }
)

# Sınırı gereğinden geniş çizilmiş bir yerleşkenin içine düşen kamu caddeleri.
# Alanın tamamen içinde kalsalar bile açık bırakılırlar. Yeni bir kayıt eklemeden
# önce caddenin gerçekten halka açık olduğu doğrulanmalıdır; çalışma sonundaki
# "denetim" listesi aday isimleri gösterir.
ALWAYS_OPEN_STREET_NAMES = frozenset({"Necatibey Caddesi"})

# Düğümlerinin bu oranı kapalı alanda kalan yol, alanın iç yolu sayılır. Kampüs
# iç yollarının uçları kapıda dışarıdaki ağa bağlandığı için tam kapsama aranmaz.
INTERNAL_ROAD_RATIO = 0.9

# Denetim uyarısı üretilecek sınıflar: bu sınıflardan isimli bir yolun
# maskelenmesi, poligonun kamu yolunu içine almış olabileceğine işarettir.
AUDITED_HIGHWAY_CLASSES = frozenset(
    {"motorway", "trunk", "primary", "secondary", "primary_link", "secondary_link"}
)


class Area:
    def __init__(self, name, rings):
        self.name = name
        self.rings = rings
        lons = [x for ring in rings for x, _ in ring]
        lats = [y for ring in rings for _, y in ring]
        self.bbox = (min(lons), min(lats), max(lons), max(lats))

    def contains(self, lon, lat):
        min_lon, min_lat, max_lon, max_lat = self.bbox
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            return False
        # Delikli poligonlarda dış halka ile delikler aynı even-odd sayımına
        # girer; tek sayı içeride, çift sayı dışarıda demektir.
        inside = False
        for ring in self.rings:
            for index in range(len(ring) - 1):
                x1, y1 = ring[index]
                x2, y2 = ring[index + 1]
                if (y1 > lat) != (y2 > lat):
                    crossing = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
                    if lon < crossing:
                        inside = not inside
        return inside


def load_areas(path):
    with open(path, encoding="utf-8") as handle:
        collection = json.load(handle)

    areas = []
    for feature in collection["features"]:
        name = feature["properties"]["name"]
        geometry = feature["geometry"]
        if geometry["type"] == "Polygon":
            polygons = [geometry["coordinates"]]
        elif geometry["type"] == "MultiPolygon":
            polygons = geometry["coordinates"]
        else:
            raise ValueError(f"{name}: desteklenmeyen geometri {geometry['type']}")
        for polygon in polygons:
            areas.append(Area(name, [[(x, y) for x, y in ring] for ring in polygon]))
    return areas


class NodeCollector(osmium.SimpleHandler):
    def __init__(self, areas):
        super().__init__()
        self.areas = areas
        min_lon = min(a.bbox[0] for a in areas)
        min_lat = min(a.bbox[1] for a in areas)
        max_lon = max(a.bbox[2] for a in areas)
        max_lat = max(a.bbox[3] for a in areas)
        self.envelope = (min_lon, min_lat, max_lon, max_lat)
        self.inside_node_ids = set()

    def node(self, node):
        location = node.location
        if not location.valid():
            return
        lon = location.lon
        lat = location.lat
        min_lon, min_lat, max_lon, max_lat = self.envelope
        if not (min_lon <= lon <= max_lon and min_lat <= lat <= max_lat):
            return
        if any(area.contains(lon, lat) for area in self.areas):
            self.inside_node_ids.add(node.id)


class Masker(osmium.SimpleHandler):
    def __init__(self, writer, inside_node_ids):
        super().__init__()
        self.writer = writer
        self.inside_node_ids = inside_node_ids
        self.masked_count = 0
        self.audit_names = set()
        self.kept_open = set()

    def node(self, node):
        self.writer.add_node(node)

    def relation(self, relation):
        self.writer.add_relation(relation)

    def way(self, way):
        if self._should_mask(way):
            name = way.tags.get("name")
            if name and way.tags.get("highway") in AUDITED_HIGHWAY_CLASSES:
                self.audit_names.add(name)
            tags = {tag.k: tag.v for tag in way.tags}
            tags["access"] = "no"
            self.writer.add_way(way.replace(tags=tags))
            self.masked_count += 1
        else:
            self.writer.add_way(way)

    def _should_mask(self, way):
        highway = way.tags.get("highway")
        if highway is None:
            return False

        name = way.tags.get("name")
        if name in ALWAYS_OPEN_STREET_NAMES:
            self.kept_open.add(name)
            return False

        refs = [node.ref for node in way.nodes]
        if len(refs) < 2:
            return False

        # Gövdesi neredeyse tümüyle kapalı alanda kalan bir yol, sınıfı ne olursa
        # olsun içeriye aittir: kamuya açık bir güzergâh alanı terk etmek
        # zorundadır. Kampüs içi yollar uçlarıyla kapıya bağlandığı için tam
        # kapsama yerine oran aranır. OSM bu yolları kampüs içinde bile tertiary
        # veya access=yes etiketleyebildiğinden sınıf ayrımı burada yapılmaz.
        inside_count = sum(1 for ref in refs if ref in self.inside_node_ids)
        if inside_count / len(refs) >= INTERNAL_ROAD_RATIO:
            return True

        if highway in THROUGH_HIGHWAY_CLASSES:
            return False

        # Kapalı alana giren çıkmaz yolların uç düğümü kapıda, dışarıdaki kamu
        # yoluyla paylaşılır. Uçları saymayıp gövdesi tamamen içeride kalan
        # yolları maskelemek bu yolları da yakalar; alanı sadece kesip geçen
        # kamu yolları ise dışarıda kalan ara düğümleri sayesinde korunur.
        body = refs[1:-1] if len(refs) > 2 else refs
        return all(ref in self.inside_node_ids for ref in body)


def main():
    if len(sys.argv) != 4:
        print("kullanım: mask-restricted-areas.py <girdi.pbf> <cikti.pbf> <alanlar.geojson>", file=sys.stderr)
        return 2

    source, destination, areas_path = sys.argv[1:4]
    areas = load_areas(areas_path)
    if not areas:
        raise ValueError(f"{areas_path} içinde kapalı alan tanımı yok.")
    print(f"{len(areas)} kapalı alan yüklendi: {', '.join(sorted({a.name for a in areas}))}")

    collector = NodeCollector(areas)
    collector.apply_file(source)
    print(f"Kapalı alan içindeki düğüm sayısı: {len(collector.inside_node_ids)}")

    writer = osmium.SimpleWriter(destination)
    try:
        masker = Masker(writer, collector.inside_node_ids)
        masker.apply_file(source)
    finally:
        writer.close()

    print(f"access=no ile işaretlenen yol sayısı: {masker.masked_count}")
    if masker.kept_open:
        print(f"İstisna gereği açık bırakıldı: {', '.join(sorted(masker.kept_open))}")
    if masker.audit_names:
        print(
            "DENETİM — ana arter sınıfında maskelenen isimli yollar "
            f"({len(masker.audit_names)}): {', '.join(sorted(masker.audit_names))}"
        )
        print(
            "Bu yollardan biri gerçekte halka açıksa poligonu düzeltin veya adını "
            "ALWAYS_OPEN_STREET_NAMES listesine ekleyin."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
