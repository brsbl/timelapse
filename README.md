# timelapse

Turn spatial datasets with a time dimension into animated map videos and stills. This repository contains worked examples for New York City and Chicago, plus a BB plugin for frame review, light editing, and export.

## Scenes

| City | Scene | Encoding |
| --- | --- | --- |
| New York City | Manhattan buildings | Extrusion grows when each building was built; color shows era |
| New York City | Weekday subway | Trains move along scheduled MTA routes |
| Chicago | Downtown buildings | Extrusion grows by construction year |
| Chicago | CTA L trains | Trains move along scheduled CTA routes |
| Chicago | Station ridership, Jan 2019–Dec 2021 | Column height shows average weekday entries; color shows change from Sep 2019 |
| Chicago | Divvy, Sep 18 2019 | Raised arcs connect trip start and end areas by hour; arcs are connections, not ridden routes |

The Chicago ridership and Divvy scenes use different 3D encodings from the building and train scenes. Source datasets stay out of Git; the build scripts fetch and aggregate them locally.

## Run the examples

Requires Node 22+, `ffmpeg`, `curl`, and `unzip`. The BB plugin additionally needs `ffprobe` and ImageMagick `magick` on the workspace host.

```sh
npm install
npm run fetch:nyc
npm run build:nyc
npm run fetch:chicago
npm run build:chicago
npm run build:activity
npm run serve
```

Open [the renderer](http://localhost:5177/) and choose a scene. Use `?city=chicago` for Chicago and `?format=portrait` for a 1080 × 1350 frame. `npm run build:activity` writes `public/data/chicago/ridership.json` and `divvy.json` from CTA monthly ridership and one day of Divvy trips.

Chicago's building footprint data has no year for about half of downtown's buildings, mostly low-rise. Those appear as flat grey footprints. Years run through 2015 and heights are estimated from floor counts.

## Render and edit

`scripts/record.sh` renders frames in BB's Browser Automation plugin, then encodes them with `ffmpeg`. For example:

```sh
CITY=chicago FORMAT=portrait bash scripts/record.sh <bb-host-id> ridership 0 840 chicago-ridership
```

Frames and videos land in ignored `out/`. See [the BB plugin](bb-plugin-timelapse/README.md) for frame stepping, trims, captions, stills, and exported videos. The plugin reads completed MP4 files under `out/` and writes exports to `out/edits/`. It does not create scenes or render source frames.

## Data sources

- [NYC Building Footprints](https://data.cityofnewyork.us/Housing-Development/Building-Footprints/5zhs-2jue): construction year and roof height.
- [MTA subway GTFS](https://new.mta.info/developers): weekday schedule.
- [Chicago Building Footprints](https://data.cityofchicago.org/Buildings/Building-Footprints/uc4b-9zys): building outlines and construction year where available.
- [CTA GTFS](https://www.transitchicago.com/developers/gtfs/): scheduled L service and station coordinates.
- [CTA Monthly Ridership](https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Monthly-Day-Type-Ave/t2rn-p8d7): average weekday station entries.
- [Divvy system data](https://divvybikes.com/system-data): trip start/end coordinates and times. The [data license](https://divvybikes.com/data-license-agreement) permits visualization but limits standalone redistribution of raw trip data, so raw records are excluded from this repository.
- Basemap © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by [OpenFreeMap](https://openfreemap.org).

## License

MIT
