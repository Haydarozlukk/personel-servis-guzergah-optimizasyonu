#!/usr/bin/env bash
set -Eeuo pipefail

readonly source_pbf=/map/ankara.osm.pbf
readonly data_dir=/data
readonly staging_dir=/data/.prepare-tmp
readonly ready_file=/data/.ready
readonly ready_tmp=/data/.ready.tmp

cleanup() {
  rm -rf "$staging_dir"
  rm -f "$ready_tmp"
}

profile_is_complete() {
  local directory=$1
  local profile=$2
  local suffix

  for suffix in properties partition cells cell_metrics mldgr; do
    if [[ ! -s "$directory/$profile.osrm.$suffix" ]]; then
      return 1
    fi
  done
}

data_is_current() {
  local pbf_sha=$1
  local osrm_version=$2

  [[ -s "$ready_file" ]] || return 1
  grep -Fqx "pbf_sha256=$pbf_sha" "$ready_file" || return 1
  grep -Fqx "osrm_version=$osrm_version" "$ready_file" || return 1
  profile_is_complete "$data_dir" foot || return 1
  profile_is_complete "$data_dir" car || return 1
}

prepare_profile() {
  local profile=$1

  echo "OSRM $profile profili çıkarılıyor."
  osrm-extract \
    -p "/opt/$profile.lua" \
    -o "$staging_dir/$profile.osrm" \
    "$source_pbf"
  osrm-partition "$staging_dir/$profile.osrm"
  osrm-customize "$staging_dir/$profile.osrm"
}

if [[ ! -s "$source_pbf" ]]; then
  echo "OSRM girdisi bulunamadı veya boş: $source_pbf" >&2
  exit 1
fi

pbf_sha=$(sha256sum "$source_pbf" | awk '{print $1}')
osrm_version=$(osrm-extract --version)

if data_is_current "$pbf_sha" "$osrm_version"; then
  echo "OSRM car ve foot verileri hazır; ön işleme atlanıyor."
  exit 0
fi

trap cleanup EXIT INT TERM
rm -rf "$staging_dir"
mkdir -p "$staging_dir"

prepare_profile foot
prepare_profile car

profile_is_complete "$staging_dir" foot
profile_is_complete "$staging_dir" car

# Eski geçerli veri, yeni veri tamamen hazır olana kadar korunur. Hazır işareti
# en son yayımlanır; yarım kalan bir çalışma routed servislerini başlatmaz.
rm -f "$ready_file"
rm -f "$data_dir"/foot.osrm* "$data_dir"/car.osrm*
find "$staging_dir" -maxdepth 1 -type f -exec mv {} "$data_dir"/ \;

{
  echo "pbf_sha256=$pbf_sha"
  echo "osrm_version=$osrm_version"
  echo "profiles=foot,car"
} > "$ready_tmp"
mv "$ready_tmp" "$ready_file"

trap - EXIT INT TERM
rm -rf "$staging_dir"
echo "OSRM car ve foot verileri hazır."
