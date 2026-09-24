#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
curl -fL -o data/raw/chicago_buildings.geojson \
  "https://data.cityofchicago.org/resource/syp8-uezg.geojson?\$select=the_geom,bldg_id,year_built,stories,bldg_name1&\$where=within_box(the_geom,41.915,-87.67,41.85,-87.605)%20AND%20bldg_statu='ACTIVE'&\$limit=60000"
curl -fL -o data/raw/cta_gtfs.zip https://www.transitchicago.com/downloads/sch_data/google_transit.zip
rm -rf data/raw/cta_gtfs && unzip -q -o data/raw/cta_gtfs.zip -d data/raw/cta_gtfs
