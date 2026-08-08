#!/bin/sh
set -eu

output=/map/ankara.osm.pbf
temporary_output=/map/ankara.tmp.osm.pbf
turkey=/map/turkey-latest.tmp.osm.pbf
routing_output=/map/ankara-routing.osm.pbf
routing_temporary=/map/ankara-routing.tmp.osm.pbf
routing_marker=/map/.ankara-routing.ready
restricted_areas=/config/restricted-areas.geojson

cleanup() {
  rm -f "$temporary_output" "$turkey" "$routing_temporary"
}

trap cleanup EXIT INT TERM

prepare_base_pbf() {
  if [ -s "$output" ]; then
    if osmium fileinfo "$output" >/dev/null 2>&1; then
      echo "Ankara PBF hazır ve geçerli; yeniden indirme ve kesme atlanıyor."
      return 0
    fi

    echo "Mevcut Ankara PBF geçersiz; yeniden oluşturulacak."
    rm -f "$output"
  fi

  echo "Türkiye PBF indiriliyor: $TURKEY_PBF_URL"
  curl --fail --location --retry 5 --retry-delay 5 \
    --output "$turkey" "$TURKEY_PBF_URL"
  osmium fileinfo "$turkey" >/dev/null

  echo "Ankara kapsamı osmium ile çıkarılıyor: $ANKARA_BBOX"
  osmium extract \
    --bbox "$ANKARA_BBOX" \
    --strategy complete_ways \
    --output-format pbf \
    --output "$temporary_output" \
    "$turkey"

  osmium fileinfo "$temporary_output" >/dev/null
  mv "$temporary_output" "$output"
  rm -f "$turkey"
  echo "Ankara PBF hazır: $output"
}

# Nominatim kapalı alanları isimden bulmaya devam etsin diye maskelenmiş kopya
# ayrı dosyaya yazılır; yalnızca OSRM bu dosyayı kullanır.
prepare_routing_pbf() {
  if [ ! -s "$restricted_areas" ]; then
    echo "Kapalı alan tanımı bulunamadı: $restricted_areas" >&2
    exit 1
  fi

  signature="$(sha256sum "$output" "$restricted_areas" | awk '{print $1}' | tr '\n' ' ')"

  if [ -s "$routing_marker" ] && [ -s "$routing_output" ] \
    && grep -Fqx "inputs=$signature" "$routing_marker" \
    && osmium fileinfo "$routing_output" >/dev/null 2>&1; then
    echo "Rotalama PBF'i güncel; maskeleme atlanıyor."
    return 0
  fi

  echo "Halka kapalı alanlar maskeleniyor."
  # Öldürülmüş bir çalışmadan kalan yarım dosya yazıcıyı durdurur.
  rm -f "$routing_marker" "$routing_temporary"
  mask-restricted-areas "$output" "$routing_temporary" "$restricted_areas"
  osmium fileinfo "$routing_temporary" >/dev/null
  mv "$routing_temporary" "$routing_output"
  echo "inputs=$signature" > "$routing_marker"
  echo "Rotalama PBF'i hazır: $routing_output"
}

prepare_base_pbf
prepare_routing_pbf

trap - EXIT INT TERM
cleanup
