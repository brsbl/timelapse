# timelapse

Turn a dataset with a time dimension into an animated 3D map video and text-free stills, rendered frame by frame in a headless browser.

This repo starts from two worked examples, New York City and Chicago, made with Claude Opus 5.5.

- **Buildings:** every building in Manhattan rises in the year it was built, colored by era.
- **Subway:** every scheduled weekday train moves along its real track over 24 hours, with trail thickness showing speed.

The next step is a reusable render kit, a `timelapse` CLI and an agent direction skill, so any city or dataset can go from one prompt to a finished video.

## Run the NYC example

Requires Node 22+, `ffmpeg`, `curl` and `unzip`.

```sh
npm install
npm run fetch:nyc   # NYC Open Data building footprints + MTA subway GTFS
npm run build:nyc   # writes public/data/nyc/
npm run serve       # http://localhost:5177
```

Open http://localhost:5177 to play either act live. Add `?format=portrait` for a 1080 × 1350 frame.

## Run the Chicago example

The same renderer, configured by `cities/chicago.json`: downtown Chicago's buildings by year built, and every CTA "L" train over a weekday.

```sh
npm run fetch:chicago   # City of Chicago building footprints + CTA GTFS
npm run build:chicago
npm run serve           # http://localhost:5177/?city=chicago
```

Chicago's footprint data has no year for about half of downtown's buildings, almost all low-rise; they show as flat grey footprints. Its years run through 2015, and heights are estimated from floor counts.

## Render a video

`scripts/record.sh` renders frames and encodes them with `ffmpeg`. It currently drives a headless browser through [bb](https://getbb.app)'s Browser Automation plugin; a standalone renderer is planned.

```sh
FORMAT=portrait bash scripts/record.sh <bb-host-id> transit 0 1842 nyc-transit
```

Frames and videos land in `out/`.

## Data sources

- [NYC Building Footprints](https://data.cityofnewyork.us/Housing-Development/Building-Footprints/5zhs-2jue), NYC Open Data: construction year and roof height.
- [MTA subway GTFS](https://new.mta.info/developers), weekday schedule.
- Basemap © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by [OpenFreeMap](https://openfreemap.org).

## License

MIT
