#!/bin/sh
set -eu

output=/map/ankara.osm.pbf
temporary_output=/map/ankara.tmp.osm.pbf
turkey=/map/turkey-latest.tmp.osm.pbf

cleanup() {
  rm -f "$temporary_output" "$turkey"
}

trap cleanup EXIT INT TERM

if [ -s "$output" ]; then
  if osmium fileinfo "$output" >/dev/null 2>&1; then
    echo "Ankara PBF hazır ve geçerli; yeniden indirme ve kesme atlanıyor."
    exit 0
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
trap - EXIT INT TERM
rm -f "$turkey"
echo "Ankara PBF hazır: $output"
