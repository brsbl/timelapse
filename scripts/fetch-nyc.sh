#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
curl -fL -o data/raw/manhattan_buildings.geojson \
  'https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?$select=the_geom,bin,construction_year,height_roof,ground_elevation&$where=bin>=1000000%20AND%20bin<2000000&$limit=60000'
curl -fL -o data/raw/gtfs_subway.zip https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip
rm -rf data/raw/gtfs_subway && unzip -q -o data/raw/gtfs_subway.zip -d data/raw/gtfs_subway
