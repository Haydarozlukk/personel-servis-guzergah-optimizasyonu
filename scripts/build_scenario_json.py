#!/usr/bin/env python3
"""
ImportReady_v2.xlsx'ten dogrudan POST /api/v1/scenarios icin ScenarioInput
JSON'u uretir. Nominatim'e hic sorulmaz; kisiler ve isyeri koordinati
onceden Google/Nominatim'den elde edilmis x-y olarak gomulur.

Kullanim:
    python scripts/build_scenario_json.py --input "<ImportReady_v2.xlsx>" --output "<scenario.json>" \
        --name "..." --workplace-lon 32.756950 --workplace-lat 39.882307 --arrival "09:00:00" --vehicle-count 40
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import openpyxl

SUPPORTED_CAPACITIES = [40, 28, 18, 16]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--workplace-lon", required=True, type=float)
    parser.add_argument("--workplace-lat", required=True, type=float)
    parser.add_argument("--arrival", default="09:00:00")
    parser.add_argument("--vehicle-count", type=int, default=40)
    args = parser.parse_args()

    wb = openpyxl.load_workbook(args.input, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    header = [str(c) if c is not None else "" for c in next(rows_iter)]
    idx = {h: i for i, h in enumerate(header)}

    persons = []
    for row in rows_iter:
        sicil = str(row[idx["sicil numarası"]])
        ad_soyad = row[idx["ad soyad"]]
        lon = float(row[idx["boylam"]])
        lat = float(row[idx["enlem"]])
        persons.append({"id": sicil, "location": [lon, lat], "name": ad_soyad})

    workplace = [args.workplace_lon, args.workplace_lat]
    vehicles = [
        {
            "id": f"Servis-{i:03d}",
            "capacity": SUPPORTED_CAPACITIES[(i - 1) % len(SUPPORTED_CAPACITIES)],
            "start": workplace,
        }
        for i in range(1, args.vehicle_count + 1)
    ]

    payload = {
        "name": args.name,
        "direction": "morning_inbound",
        "workplace": workplace,
        "arrivalDeadline": args.arrival,
        "persons": persons,
        "vehicles": vehicles,
        "fleetSizeIsFixed": True,
    }

    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Kisi sayisi: {len(persons)}")
    print(f"Arac sayisi: {len(vehicles)}")
    print(f"Cikti: {args.output}")


if __name__ == "__main__":
    main()
