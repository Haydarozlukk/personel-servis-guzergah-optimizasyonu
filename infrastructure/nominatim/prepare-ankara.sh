#!/bin/sh
set -eu

output=/import/ankara.osm.pbf
temporary_output=/import/ankara.osm.pbf.tmp
turkey=/import/turkey-latest.osm.pbf

if [ -s "$output" ]; then
  echo "Ankara PBF hazır; yeniden indirme ve kesme atlanıyor."
  exit 0
fi

echo "Türkiye PBF indiriliyor: $TURKEY_PBF_URL"
curl --fail --location --retry 5 --retry-delay 5 \
  --output "$turkey" "$TURKEY_PBF_URL"

echo "Ankara kapsamı osmium ile çıkarılıyor: $ANKARA_BBOX"
rm -f "$temporary_output"
osmium extract \
  --bbox "$ANKARA_BBOX" \
  --strategy complete_ways \
  --output-format pbf \
  --output "$temporary_output" \
  "$turkey"

mv "$temporary_output" "$output"
rm -f "$turkey"
echo "Ankara PBF hazır: $output"
