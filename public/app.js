const params = new URLSearchParams(location.search);
const cityId = params.get("city") ?? "nyc";
const recording = params.get("record") === "1";
const fps = Number(params.get("fps") ?? 30);
const pixelRatio = Number(params.get("pr") ?? (recording ? 1 : devicePixelRatio));
const FORMATS = {
  landscape: {
    w: 1920, h: 1080, padding: { top: 0, bottom: 0 }, zoom: 0, chart: "right",
    layout: { x: 72, kicker: 96, head: 160, headSize: 50, headLead: 58, big: 900, bigSize: 150, stat: 960,
      chartY: 872, chartH: 90, credit: 1040, topScrim: 330, bottomScrim: 700 },
  },
  portrait: {
    w: 1080, h: 1350, padding: { top: 340, bottom: 220 }, zoom: -0.1, chart: "full",
    layout: { x: 64, kicker: 92, head: 152, headSize: 54, headLead: 60, big: 350, bigSize: 140, stat: 1150,
      chartY: 1175, chartH: 72, credit: 1330, topScrim: 470, bottomScrim: 1020 },
  },
  vertical: {
    w: 1080, h: 1920, padding: { top: 620, bottom: 0 }, zoom: 0, chart: "full",
    layout: { x: 76, kicker: 200, head: 290, headSize: 72, headLead: 82, big: 590, bigSize: 210, stat: 660,
      chartY: 705, chartH: 80, credit: 1870, topScrim: 940, bottomScrim: 1700 },
  },
};
const formatId = params.get("format") ?? "landscape";
const format = FORMATS[formatId] ?? FORMATS.landscape;
const vertical = format.h > format.w;
const width = Number(params.get("w") ?? format.w);
const height = Number(params.get("h") ?? format.h);

const BG = "#07080c";
const LEAD = 0.6;
const HOLD = 2.5;
const FADE = 0.6;

const city = await (await fetch(`/cities/${cityId}.json`)).json();
const [buildings, buildingStats, transit] = await Promise.all([
  fetch(`/data/${cityId}/buildings.geojson`).then((r) => r.json()),
  fetch(`/data/${cityId}/buildings-stats.json`).then((r) => r.json()),
  fetch(`/data/${cityId}/transit.json`).then((r) => r.json()),
]);

const stage = document.getElementById("stage");
const hud = document.getElementById("hud");
const hudCtx = hud.getContext("2d");
if (recording) document.body.classList.add("recording");

function sizeStage() {
  const w = recording ? width : innerWidth;
  const h = recording ? height : innerHeight;
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  hud.width = Math.round(w * pixelRatio);
  hud.height = Math.round(h * pixelRatio);
  hud.style.width = `${w}px`;
  hud.style.height = `${h}px`;
}
sizeStage();

const style = await (await fetch("https://tiles.openfreemap.org/styles/dark")).json();
style.transition = { duration: 0, delay: 0 };
style.sky = {
  "sky-color": "#05060d",
  "horizon-color": "#1d1733",
  "fog-color": BG,
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.7,
  "fog-ground-blend": 0.85,
  "atmosphere-blend": 0,
};
style.layers = style.layers.filter(
  (l) => l.id !== "building" && !/name|oneway|aeroway|place_(other|village|town|state|country)/.test(l.id),
);
for (const l of style.layers) {
  if (l.id === "background") l.paint = { "background-color": BG };
  if (l.id === "water") l.paint = { ...l.paint, "fill-color": "#0c1119" };
  if (l.type === "line" && /highway|road|railway/.test(l.id)) {
    l.paint = { ...l.paint, "line-opacity": 0.28 };
  }
  if (l.type === "symbol" && l.id.startsWith("place_")) {
    l.paint = { ...l.paint, "text-color": "#8a93a8", "text-halo-color": BG, "text-opacity": 0.8 };
  }
}

const cameraKeys = (cfg) => (vertical && cfg.cameraVertical) || cfg.camera;
const firstCamera = cameraKeys(city.acts.buildings)[0];
const map = new maplibregl.Map({
  container: "map",
  style,
  center: firstCamera.center,
  zoom: firstCamera.zoom,
  pitch: firstCamera.pitch,
  bearing: firstCamera.bearing,
  maxPitch: 85,
  pixelRatio,
  canvasContextAttributes: { preserveDrawingBuffer: recording, antialias: true },
  attributionControl: false,
  fadeDuration: 0,
});
await Promise.all([
  ["Geist", "geist-sans/Geist-Variable.woff2"],
  ["Geist Mono", "geist-mono/GeistMono-Variable.woff2"],
].map(async ([family, file]) => document.fonts.add(await new FontFace(family, `url(/fonts/${file})`, { weight: "100 900" }).load())));
await Promise.all([400, 500, 600, 700, 800].map(async (weight) => document.fonts.add(
  await new FontFace("Libre Franklin", `url(/fonts/franklin/libre-franklin-latin-${weight}-normal.woff2)`, { weight: String(weight) }).load(),
)));
await new Promise((r) => map.once("load", r));
window.__map = map;

map.setLight({ anchor: "map", color: "#ffffff", intensity: 0.45, position: [1.4, 200, 35] });
map.addSource("dem", {
  type: "raster-dem",
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  tileSize: 256,
  maxzoom: 15,
  encoding: "terrarium",
});
map.addLayer(
  { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-illumination-anchor": "map" } },
  "waterway",
);
map.moveLayer("water", "waterway");
map.setPaintProperty("landcover_wood", "fill-pattern", undefined);
const WORK_CLASSES = ["commercial", "retail", "industrial", "railway", "military", "quarry"];
const CIVIC_CLASSES = ["school", "college", "university", "hospital", "kindergarten", "education", "library", "stadium"];
const GREEN_CLASSES = ["cemetery", "pitch", "recreation_ground", "zoo", "playground", "park"];
for (const layer of [
  { id: "land-class", type: "fill", "source-layer": "landuse",
    filter: ["in", ["get", "class"], ["literal", [...WORK_CLASSES, ...CIVIC_CLASSES, ...GREEN_CLASSES]]] },
  { id: "land-cover", type: "fill", "source-layer": "landcover",
    filter: ["in", ["get", "class"], ["literal", ["sand", "wetland", "grass", "wood", "farmland"]]] },
  { id: "airport", type: "fill", "source-layer": "aeroway", filter: ["==", ["geometry-type"], "Polygon"] },
  { id: "runway", type: "line", "source-layer": "aeroway", filter: ["in", ["get", "class"], ["literal", ["runway", "taxiway"]]],
    paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "class"], "runway", 1.5, 0.4], 14, ["match", ["get", "class"], "runway", 14, 3]] } },
]) {
  map.addLayer({ source: "openmaptiles", paint: {}, ...layer }, "hillshade");
}
map.setPaintProperty("landuse_residential", "fill-opacity", 1);
map.addSource("buildings", { type: "geojson", data: buildings });
map.addLayer({
  id: "buildings",
  type: "fill-extrusion",
  source: "buildings",
  paint: { "fill-extrusion-vertical-gradient": true, "fill-extrusion-opacity": 1 },
});

const SPEED_WIDTH = [15, 0.7, 22, 1.4, 30, 3, 40, 6, 50, 9];
const SPEED_GLOW = [15, 3, 22, 5, 30, 9, 40, 15, 50, 22];
const speedWidth = (v) => {
  for (let i = 2; i < SPEED_WIDTH.length; i += 2) {
    if (v <= SPEED_WIDTH[i]) return lerp(SPEED_WIDTH[i - 1], SPEED_WIDTH[i + 1], clamp01((v - SPEED_WIDTH[i - 2]) / (SPEED_WIDTH[i] - SPEED_WIDTH[i - 2])));
  }
  return SPEED_WIDTH[SPEED_WIDTH.length - 1];
};
const emptyFc = { type: "FeatureCollection", features: [] };
map.addSource("trails", { type: "geojson", data: emptyFc });
map.addSource("heads", { type: "geojson", data: emptyFc });
map.addLayer({
  id: "trail-glow",
  type: "line",
  source: "trails",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": ["get", "c"], "line-width": ["interpolate", ["linear"], ["get", "v"], ...SPEED_GLOW], "line-blur": 7, "line-opacity": ["*", 0.42, ["get", "o"]] },
});
map.addLayer({
  id: "trail",
  type: "line",
  source: "trails",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": ["get", "c"], "line-width": ["interpolate", ["linear"], ["get", "v"], ...SPEED_WIDTH], "line-opacity": ["get", "o"] },
});
map.addLayer({
  id: "head-glow",
  type: "circle",
  source: "heads",
  paint: { "circle-color": ["get", "c"], "circle-radius": 11, "circle-blur": 1, "circle-opacity": 0.7 },
});
map.addLayer({
  id: "head",
  type: "circle",
  source: "heads",
  paint: { "circle-color": "#ffffff", "circle-radius": 2.6, "circle-stroke-color": ["get", "c"], "circle-stroke-width": 1.6 },
});

const lerp = (a, b, t) => a + (b - a) * t;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function themeAt(keys, v) {
  let i = 0;
  while (i < keys.length - 2 && v > keys[i + 1].at) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = clamp01((v - a.at) / (b.at - a.at));
  const out = {};
  for (const k of Object.keys(a)) {
    out[k] = typeof a[k] === "number" ? lerp(a[k], b[k], u) : rgbHex(hexRgb(a[k]).map((c, j) => lerp(c, hexRgb(b[k])[j], u)));
  }
  return out;
}

const layersOf = (re) => style.layers.filter((l) => re.test(l.id)).map((l) => l.id);
const ROAD_LAYERS = layersOf(/^highway_/);
const RAIL_LAYERS = layersOf(/^railway/);

let wash = null;

const mixHex = (a, b, t) => rgbHex(hexRgb(a).map((c, j) => lerp(c, hexRgb(b)[j], t)));
let scrimRgb = "4,5,10";

function applyGround(g, light) {
  wash = { color: g.horizon, alpha: g.wash ?? 0.14 };
  scrimRgb = hexRgb(g.scrim).join(",");
  map.setPaintProperty("land-class", "fill-color", [
    "match", ["get", "class"],
    WORK_CLASSES, g.work,
    CIVIC_CLASSES, g.civic,
    g.green,
  ]);
  map.setPaintProperty("land-cover", "fill-color", ["match", ["get", "class"], "sand", g.sand, "wetland", g.marsh, g.green]);
  map.setPaintProperty("airport", "fill-color", mixHex(g.land, g.civic, 0.6));
  map.setPaintProperty("road_area_pier", "fill-color", g.land);
  map.setPaintProperty("road_pier", "line-color", g.land);
  map.setPaintProperty("runway", "line-color", g.road);
  map.setPaintProperty("runway", "line-opacity", Math.min(1, g.roadOpacity * 1.6));
  map.setPaintProperty("background", "background-color", g.land);
  map.setPaintProperty("landuse_residential", "fill-color", g.urban);
  map.setPaintProperty("landcover_wood", "fill-color", g.green);
  map.setPaintProperty("landuse_park", "fill-color", g.green);
  map.setPaintProperty("water", "fill-color", g.water);
  map.setPaintProperty("waterway", "line-color", g.water);
  for (const id of ROAD_LAYERS) {
    map.setPaintProperty(id, "line-color", g.road);
    map.setPaintProperty(id, "line-opacity", g.roadOpacity);
  }
  for (const id of RAIL_LAYERS) {
    map.setPaintProperty(id, "line-color", g.road);
    map.setPaintProperty(id, "line-opacity", g.roadOpacity * 0.6);
  }
  map.setPaintProperty("hillshade", "hillshade-shadow-color", g.shadow);
  map.setPaintProperty("hillshade", "hillshade-highlight-color", g.highlight);
  map.setPaintProperty("hillshade", "hillshade-accent-color", g.shadow);
  map.setPaintProperty("hillshade", "hillshade-exaggeration", g.relief);
  map.setPaintProperty("hillshade", "hillshade-illumination-direction", Math.round(((light.azimuth % 360) + 360) % 360));
  map.setSky({
    "sky-color": g.sky,
    "horizon-color": g.horizon,
    "fog-color": g.fog,
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.85,
    "atmosphere-blend": 0,
  });
  map.setLight({
    anchor: "map",
    color: g.light,
    intensity: g.lightIntensity,
    position: [1.4, ((light.azimuth % 360) + 360) % 360, Math.max(12, Math.min(80, 90 - light.altitude))],
  });
}

const ERAS = city.eras ?? [
  { at: 1820, label: "Farms & harbor" },
  { at: 1855, label: "Tenements & factories" },
  { at: 1898, label: "The skyscraper age" },
  { at: 1945, label: "The modern city" },
  { at: 1980, label: "Glass & steel" },
];
const eraAt = (year) => {
  const i = Math.max(0, ERAS.findLastIndex((e) => year >= e.at));
  return { label: ERAS[i].label, span: `${ERAS[i].at}–${ERAS[i + 1]?.at ?? "today"}` };
};

const NATURAL = {
  land: "#f0eee9", urban: "#f0eee9", green: "#d5e3c4", water: "#c0d8e6", road: "#ffffff", roadOpacity: 1,
  work: "#f0eee9", civic: "#f0eee9", sand: "#efe6cf", marsh: "#d0e0cc", scrim: "#f0eee9",
  shadow: "#000000", highlight: "#ffffff", relief: 0, sky: "#e3ebf1", horizon: "#f3f1ec", fog: "#f0eee9",
  light: "#ffffff", lightIntensity: 0.3, wash: 0,
};
const TERRAIN_LAYERS = ["hillshade", "land-class", "land-cover", "airport", "runway"];
function setTerrainVisible(visible) {
  for (const id of TERRAIN_LAYERS) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}
function setLabelInk(color, halo) {
  for (const l of style.layers) {
    if (l.type !== "symbol" || !l.id.startsWith("place_")) continue;
    map.setPaintProperty(l.id, "text-color", color);
    map.setPaintProperty(l.id, "text-halo-color", halo);
  }
}

const SKY = [
  { at: -14, land: "#131a3c", urban: "#131a3c", green: "#113a38", water: "#081640", road: "#3d4f8c", roadOpacity: 0.3,
    work: "#1e2550", civic: "#172050", sand: "#35344f", marsh: "#12323c", scrim: "#04071a",
    shadow: "#040716", highlight: "#26336a", relief: 0.7, sky: "#030718", horizon: "#1f2d66", fog: "#0c1230",
    light: "#8fa6ff", lightIntensity: 0.2, buildings: "#232c5c", wash: 0.2 },
  { at: -4, land: "#20204a", urban: "#20204a", green: "#1b3d42", water: "#16185a", road: "#524f90", roadOpacity: 0.32,
    work: "#2c2a5e", civic: "#26265a", sand: "#4a4262", marsh: "#1d3548", scrim: "#080722",
    shadow: "#070620", highlight: "#5e4f96", relief: 0.8, sky: "#1f1f55", horizon: "#b06aa8", fog: "#1a1840",
    light: "#b49cff", lightIntensity: 0.32, buildings: "#3a3470", wash: 0.34 },
  { at: 3, land: "#402a4a", urban: "#402a4a", green: "#2e5044", water: "#3a2f6e", road: "#8a5f68", roadOpacity: 0.3,
    work: "#4e3456", civic: "#4a3258", sand: "#b98a70", marsh: "#2f5058", scrim: "#150a1a",
    shadow: "#12081a", highlight: "#e0935c", relief: 1, sky: "#4a3f80", horizon: "#ff9a5c", fog: "#3a2640",
    light: "#ffa468", lightIntensity: 0.62, buildings: "#8a5048", wash: 0.44 },
  { at: 14, land: "#31445e", urban: "#31445e", green: "#3a7050", water: "#1d4f80", road: "#7d92b3", roadOpacity: 0.26,
    work: "#4a5a80", civic: "#3a4e72", sand: "#b5a37a", marsh: "#3a6a63", scrim: "#081020",
    shadow: "#0b1220", highlight: "#98a8c2", relief: 1, sky: "#3a64a0", horizon: "#bcd4ea", fog: "#243650",
    light: "#fff3e0", lightIntensity: 0.64, buildings: "#5d7196", wash: 0.18 },
  { at: 45, land: "#354a66", urban: "#354a66", green: "#3f7a52", water: "#1f5688", road: "#8499b8", roadOpacity: 0.25,
    work: "#50628a", civic: "#3e5478", sand: "#c2af82", marsh: "#3e7068", scrim: "#081122",
    shadow: "#0c1422", highlight: "#a5b4cc", relief: 0.95, sky: "#4270ae", horizon: "#d4e3f2", fog: "#283c58",
    light: "#ffffff", lightIntensity: 0.68, buildings: "#6a7fa6", wash: 0.16 },
];

const WORK_LIT = "#9cc2f0";
function workHours(clock) {
  const h = clock / 3600;
  const ramp = (a, b) => clamp01((h - a) / (b - a));
  return Math.min(ramp(6.5, 9), 1 - ramp(17.5, 20.5));
}

const SUN_DATE_DECLINATION = 0;
function sunAt(clockSeconds, lat, lon, utcOffsetHours) {
  const hours = clockSeconds / 3600;
  const solarNoon = 12 + utcOffsetHours - lon / 15 - 0.13;
  const H = ((hours - solarNoon) * 15 * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const d = (SUN_DATE_DECLINATION * Math.PI) / 180;
  const alt = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi));
  return { altitude: (alt * 180) / Math.PI, azimuth: (az * 180) / Math.PI + 180 };
}
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => t * t * (3 - 2 * t);

function cameraAt(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = smooth(clamp01((t - a.t) / (b.t - a.t)));
  return {
    center: [lerp(a.center[0], b.center[0], u), lerp(a.center[1], b.center[1], u)],
    zoom: lerp(a.zoom, b.zoom, u),
    pitch: lerp(a.pitch, b.pitch, u),
    bearing: lerp(a.bearing, b.bearing, u),
  };
}

const SPARK_BIN_YEARS = 5;
const buildingBins = [];
buildingStats.perYear.forEach((n, i) => {
  const b = Math.floor(i / SPARK_BIN_YEARS);
  buildingBins[b] = (buildingBins[b] ?? 0) + n;
});
const cumulativeBuildings = [];
buildingStats.perYear.reduce((acc, n, i) => (cumulativeBuildings[i] = acc + n), 0);

const GROW_YEARS = city.acts.buildings.growYears ?? 3;
const HEIGHT_SCALE = Number(params.get("hs") ?? city.acts.buildings.heightScale ?? 1);
const ERA_SWATCHES = [
  [1820, "#9c4f38"], [1875, "#b85a32"], [1905, "#ce8240"], [1930, "#d9a85c"],
  [1955, "#b3a792"], [1975, "#8898ae"], [1995, "#5a8fb6"], [2026, "#3fa6cf"],
];
function eraColor(year) {
  const i = ERA_SWATCHES.findIndex(([y]) => y >= year);
  if (i <= 0) return ERA_SWATCHES[Math.max(0, i)][1];
  const [y0, c0] = ERA_SWATCHES[i - 1];
  const [y1, c1] = ERA_SWATCHES[i];
  return mixHex(c0, c1, (year - y0) / (y1 - y0));
}
const byHeight = (short, tall) => ["interpolate", ["linear"], ["get", "h"], 12, short, 220, tall];
const MATERIAL = [
  "interpolate", ["linear"], ["get", "y"],
  1820, byHeight("#8e4533", "#a9553d"),
  1875, byHeight("#a94a2c", "#c8653a"),
  1905, byHeight("#c06a36", "#dc9a4a"),
  1930, byHeight("#c9904e", "#e8bf6a"),
  1955, byHeight("#a89a86", "#c9bfae"),
  1975, byHeight("#7f8a99", "#8fa6c4"),
  1995, byHeight("#5e7f9e", "#4f9cc6"),
  2026, byHeight("#4d86ab", "#35c2de"),
];
const buildingsAct = {
  enter() {
    setTransitVisible(false);
    map.getSource("trails").setData(emptyFc);
    map.getSource("heads").setData(emptyFc);
    setTerrainVisible(false);
    setLabelInk("#6d717a", NATURAL.land);
    applyGround(NATURAL, { azimuth: 315, altitude: 40 });
  },
  update(p, pRaw = p) {
    const year = lerp(buildingStats.minYear, buildingStats.maxYear, p);
    const growthYear = Math.max(year, lerp(buildingStats.minYear, buildingStats.maxYear, pRaw));
    const age = ["-", growthYear, ["get", "y"]];
    const undated = ["==", ["get", "y"], 0];
    map.setPaintProperty("buildings", "fill-extrusion-height", ["case", undated, 1.5, [
      "*", ["get", "h"], HEIGHT_SCALE,
      ["interpolate", ["cubic-bezier", 0.25, 0.1, 0.25, 1], age, 0, 0, GROW_YEARS, 1],
    ]]);
    const split = params.get("split")?.match(/^(before|since)(\d{4})$/);
    map.setPaintProperty("buildings", "fill-extrusion-color", ["case", undated, "#e2ded6", split
      ? ["case", [split[1] === "before" ? "<" : ">=", ["get", "y"], Number(split[2])], MATERIAL, "#dedad2"]
      : [
        "interpolate", ["linear"], age,
        -0.001, NATURAL.land,
        0, "#ffc94d",
        GROW_YEARS * 0.85, MATERIAL,
      ]]);
    return { year };
  },
  overlay(state) {
    const year = Math.floor(state.year);
    const idx = Math.max(0, Math.min(cumulativeBuildings.length - 1, year - buildingStats.minYear));
    const era = eraAt(year);
    return {
      year: state.year,
      big: String(year),
      era: `${era.label} · ${era.span}`,
      eraLabel: era.label,
      eraSpan: era.span,
      count: cumulativeBuildings[idx],
      stat: `${cumulativeBuildings[idx].toLocaleString()} buildings standing`,
      series: buildingBins,
      playhead: (state.year - buildingStats.minYear) / (buildingStats.perYear.length - 1),
      labels: [String(buildingStats.minYear), String(buildingStats.maxYear)],
      credit: city.acts.buildings.source ?? `NYC Open Data footprints · pre-1900 dates approximate${HEIGHT_SCALE !== 1 ? ` · heights ×${HEIGHT_SCALE}` : ""}`,
    };
  },
};

const trips = transit.trips.map((t) => ({
  color: transit.routeColors[t.r],
  s: t.s,
  shape: transit.shapes[t.s],
  p: t.p,
  start: t.p[1],
  end: t.p[t.p.length - 1],
}));

function distAt(trip, t) {
  const p = trip.p;
  if (t <= p[1]) return p[0];
  if (t >= p[p.length - 1]) return p[p.length - 2];
  let lo = 0;
  let hi = p.length / 2 - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p[mid * 2 + 1] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = p[lo * 2 + 1];
  const t1 = p[hi * 2 + 1];
  return lerp(p[lo * 2], p[hi * 2], t1 === t0 ? 1 : (t - t0) / (t1 - t0));
}

function vertexIndexAt(shape, d) {
  let lo = 0;
  let hi = shape.d.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (shape.d[mid] <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

function pointAt(shape, d) {
  const i = vertexIndexAt(shape, d);
  const j = Math.min(i + 1, shape.d.length - 1);
  const span = shape.d[j] - shape.d[i];
  const u = span > 0 ? clamp01((d - shape.d[i]) / span) : 0;
  return [lerp(shape.c[i * 2], shape.c[j * 2], u), lerp(shape.c[i * 2 + 1], shape.c[j * 2 + 1], u)];
}

function pathBetween(shape, d0, d1) {
  const coords = [pointAt(shape, d0)];
  const i0 = vertexIndexAt(shape, d0) + 1;
  const i1 = vertexIndexAt(shape, d1);
  for (let i = i0; i <= i1; i++) coords.push([shape.c[i * 2], shape.c[i * 2 + 1]]);
  coords.push(pointAt(shape, d1));
  return coords;
}

const TRAIL_SECONDS = 420;
const TRAIL_PIECES = 6;
const DAY_BUCKET = 300;
const transitCfg = city.acts.transit;
const dayStart = transitCfg.startHour * 3600;
const dayEnd = transitCfg.endHour * 3600;
const runningPerBucket = [];
for (let t = dayStart; t < dayEnd; t += DAY_BUCKET) {
  const mid = t + DAY_BUCKET / 2;
  let n = 0;
  for (const trip of trips) if ((trip.start <= mid && trip.end >= mid) || (trip.start <= mid + 86400 && trip.end >= mid + 86400) || (trip.start <= mid - 86400 && trip.end >= mid - 86400)) n++;
  runningPerBucket.push(n);
}

function setTransitVisible(visible) {
  for (const id of ["trail-glow", "trail", "head-glow", "head"]) {
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

const densityMode = params.get("density") === "1";
const heatMode = params.get("density") === "heat";
let densityFc = null;
function densityFeatures() {
  if (densityFc) return densityFc;
  const groups = new Map();
  for (const trip of trips) {
    const key = `${trip.s}|${trip.color}|${Math.round(trip.p[0])}|${Math.round(trip.p[trip.p.length - 2])}`;
    const g = groups.get(key) ?? { trip, n: 0 };
    g.n++;
    groups.set(key, g);
  }
  densityFc = {
    type: "FeatureCollection",
    features: [...groups.values()].map(({ trip, n }) => ({
      type: "Feature",
      properties: { c: trip.color, n, o: 1, v: 30 },
      geometry: { type: "LineString", coordinates: pathBetween(trip.shape, trip.p[0], trip.p[trip.p.length - 2]) },
    })),
  };
  return densityFc;
}

function heatFeatures() {
  const cell = 0.0015;
  const counts = new Map();
  for (const trip of trips) {
    for (let t = trip.start; t <= trip.end; t += 8) {
      const [lng, lat] = pointAt(trip.shape, distAt(trip, t));
      const key = `${Math.round(lng / cell)},${Math.round(lat / cell)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const max = Math.max(...counts.values());
  return {
    type: "FeatureCollection",
    features: [...counts].map(([key, n]) => {
      const [x, y] = key.split(",").map(Number);
      return { type: "Feature", properties: { w: Math.log1p(n) / Math.log1p(max) }, geometry: { type: "Point", coordinates: [x * cell, y * cell] } };
    }),
  };
}

function heatLineFeatures() {
  const cell = 0.0015;
  const key = (lng, lat) => `${Math.round(lng / cell)},${Math.round(lat / cell)}`;
  const counts = new Map();
  const used = new Set();
  for (const trip of trips) {
    used.add(trip.shape);
    for (let t = trip.start; t <= trip.end; t += 8) {
      const [lng, lat] = pointAt(trip.shape, distAt(trip, t));
      const k = key(lng, lat);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const max = Math.log1p(Math.max(...counts.values()));
  const features = [];
  for (const shape of used) {
    const c = shape.c;
    const raw = [];
    for (let i = 0; i + 3 < c.length; i += 2) raw.push(Math.log1p(counts.get(key((c[i] + c[i + 2]) / 2, (c[i + 1] + c[i + 3]) / 2)) ?? 0) / max);
    let run = null;
    raw.forEach((_, j) => {
      const lo = Math.max(0, j - 4);
      const hi = Math.min(raw.length, j + 5);
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += raw[k];
      const w = Math.round((sum / (hi - lo)) * 12) / 12;
      const i = j * 2;
      if (!run || run.w !== w) {
        if (run) features.push({ type: "Feature", properties: { w: run.w }, geometry: { type: "LineString", coordinates: run.coords } });
        run = { w, coords: [[c[i], c[i + 1]]] };
      }
      run.coords.push([c[i + 2], c[i + 3]]);
    });
    if (run) features.push({ type: "Feature", properties: { w: run.w }, geometry: { type: "LineString", coordinates: run.coords } });
  }
  features.sort((a, b) => a.properties.w - b.properties.w);
  return { type: "FeatureCollection", features };
}

function dimBasemap() {
  for (const l of map.getStyle().layers) {
    if (l.type === "line" && !l.id.startsWith("trail")) map.setPaintProperty(l.id, "line-opacity", 0.07);
    if (l.type === "fill" && !/water|background/.test(l.id)) map.setPaintProperty(l.id, "fill-opacity", 0.12);
  }
}

const transitAct = {
  enter() {
    setTransitVisible(true);
    if (heatMode && !map.getSource("heat")) {
      const ramp = ["interpolate", ["linear"], ["get", "w"], 0.3, "#27458f", 0.55, "#3a6fd0", 0.72, "#5f9ee8", 0.84, "#7db8f0", 0.93, "#d6ebff", 1, "#ffffff"];
      map.addSource("heat", { type: "geojson", data: heatLineFeatures() });
      map.addLayer({
        id: "heat-glow",
        type: "line",
        source: "heat",
        layout: { "line-cap": "butt", "line-join": "round", "line-sort-key": ["get", "w"] },
        paint: { "line-color": ramp, "line-width": ["interpolate", ["linear"], ["get", "w"], 0.3, 4, 1, 22], "line-blur": 10, "line-opacity": ["interpolate", ["linear"], ["get", "w"], 0.3, 0.15, 1, 0.55] },
      });
      map.addLayer({
        id: "heat",
        type: "line",
        source: "heat",
        layout: { "line-cap": "butt", "line-join": "round", "line-sort-key": ["get", "w"] },
        paint: { "line-color": ramp, "line-width": ["interpolate", ["linear"], ["get", "w"], 0.3, 1.2, 1, 5] },
      });
    }
    if (densityMode) {
      map.setPaintProperty("trail", "line-width", ["interpolate", ["linear"], ["get", "n"], 1, 1, 40, 3, 150, 7]);
      map.setPaintProperty("trail", "line-opacity", 0.85);
      map.setPaintProperty("trail-glow", "line-width", ["interpolate", ["linear"], ["get", "n"], 1, 4, 40, 10, 150, 20]);
      map.setPaintProperty("trail-glow", "line-opacity", 0.35);
    }
    setTerrainVisible(true);
    setLabelInk("#8a93a8", BG);
    map.setPaintProperty("buildings", "fill-extrusion-height", ["get", "h"]);
  },
  update(p) {
    const now = lerp(dayStart, dayEnd, p);
    const trails = [];
    const heads = [];
    let running = 0;
    for (const trip of densityMode || heatMode ? [] : trips) {
      for (const t of [now, now - 86400, now + 86400]) {
        if (t < trip.start || t > trip.end) continue;
        running++;
        const head = distAt(trip, t);
        heads.push({ type: "Feature", properties: { c: trip.color }, geometry: { type: "Point", coordinates: pointAt(trip.shape, head) } });
        for (let k = 0; k < TRAIL_PIECES; k++) {
          const ta = Math.max(trip.start, t - (TRAIL_SECONDS * (k + 1)) / TRAIL_PIECES);
          const tb = t - (TRAIL_SECONDS * k) / TRAIL_PIECES;
          if (tb <= trip.start) break;
          const da = distAt(trip, ta);
          const db = distAt(trip, tb);
          if (db - da < 1) continue;
          trails.push({
            type: "Feature",
            properties: { c: trip.color, o: Math.pow(1 - k / TRAIL_PIECES, 1.6), v: ((db - da) / (tb - ta)) * 3.6 },
            geometry: { type: "LineString", coordinates: pathBetween(trip.shape, da, db) },
          });
        }
      }
    }
    const clock = ((now % 86400) + 86400) % 86400;
    const sun = sunAt(clock, city.lat, city.lon, city.utcOffset);
    const sky = themeAt(SKY, sun.altitude);
    sky.work = mixHex(sky.work, WORK_LIT, 0.4 * workHours(clock));
    applyGround(sky, sun.altitude > -2 ? sun : { azimuth: 200, altitude: 35 });
    map.setPaintProperty("buildings", "fill-extrusion-color", sky.buildings);
    map.getSource("trails").setData(densityMode ? densityFeatures() : { type: "FeatureCollection", features: trails });
    map.getSource("heads").setData({ type: "FeatureCollection", features: heads });
    if (heatMode) dimBasemap();
    return { now, running };
  },
  overlay(state) {
    const secs = ((state.now % 86400) + 86400) % 86400;
    const h24 = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return {
      big: `${h12}:${String(m).padStart(2, "0")}`,
      suffix: h24 < 12 ? "AM" : "PM",
      stat: `${state.running.toLocaleString()} trains running`,
      series: runningPerBucket,
      playhead: (state.now - dayStart) / (dayEnd - dayStart),
      labels: [`${transitCfg.startHour % 12 || 12} AM`, "noon", `${transitCfg.endHour % 12 || 12} AM`],
      credit: transitCfg.source ?? "MTA GTFS weekday schedule · every scheduled train",
    };
  },
};

const SERIF = "Baskerville, 'Baskerville Old Face', Georgia, serif";
const DIDONE = "Didot, 'Bodoni 72', 'Bodoni MT', serif";
const GROTESK = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const SANS = "Geist, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono', ui-monospace, Menlo, monospace";
const FRANKLIN = "'Libre Franklin', 'Franklin Gothic Medium', Helvetica, Arial, sans-serif";
const CHELT = "Georgia, 'Times New Roman', serif";
const TYPE = {
  nyt: {
    layout: {
      portrait: { head: 104, headSize: 46, headLead: 54, dek: 200, big: 340, bigSize: 116, era: 386, stat: 420,
        topScrim: 560, chartLabel: 1168, chartY: 1184, chartH: 64, ticks: 1276, credit: 1318, bottomScrim: 1050 },
    },
  },
  editorial: {
    kicker: { font: `italic 400 32px ${SERIF}`, tracking: 0, upper: false },
    head: { font: `500 {size}px ${SANS}`, tracking: -0.5, scale: 1 },
    big: { font: `700 {size}px ${DIDONE}`, tracking: -3 },
    era: { font: `500 21px ${MONO}`, tracking: 2.4, upper: true, below: true },
    layout: {
      portrait: { kicker: 86, head: 128, headSize: 32, headLead: 40, big: 332, bigSize: 156, era: 378, topScrim: 560 },
    },
    suffix: { font: `400 {size}px ${SANS}` },
    stat: { font: `500 27px ${SANS}` },
    label: { font: `500 20px ${MONO}` },
    credit: { font: `400 18px ${SANS}` },
    rule: false,
  },
  signage: {
    kicker: { font: `700 27px ${GROTESK}`, tracking: 0.2, upper: false },
    head: { font: `700 {size}px ${GROTESK}`, tracking: -1.4, scale: 1 },
    big: { font: `500 {size}px ${GROTESK}`, tracking: -5 },
    era: { font: `500 {size}px ${GROTESK}`, scale: 0.2 },
    suffix: { font: `500 {size}px ${GROTESK}` },
    stat: { font: `500 36px ${GROTESK}` },
    label: { font: `500 22px ${GROTESK}` },
    credit: { font: `400 19px ${GROTESK}` },
    rule: true,
  },
};
const INKS = {
  light: { text: "#ffffff", body: "rgba(236,238,245,0.9)", muted: "rgba(220,226,240,0.62)", faint: "rgba(210,216,230,0.45)",
    base: "rgba(255,255,255,0.07)", baseLine: "rgba(255,255,255,0.18)", shadow: "rgba(0,0,0,0.55)", dot: "#fff" },
  dark: { text: "#1a1f28", body: "rgba(26,31,40,0.86)", muted: "rgba(26,31,40,0.6)", faint: "rgba(26,31,40,0.45)",
    base: "rgba(26,31,40,0.06)", baseLine: "rgba(26,31,40,0.2)", shadow: "rgba(0,0,0,0)", dot: "#1a1f28" },
};
const inkOf = (cfg) => INKS[cfg.look?.ink ?? "light"];
const typeFont = (spec, s, size = 0) => spec.font.replace(/(\d+)px/, (_, n) => `${Number(n) * s}px`).replace("{size}", String(size * s));

function drawFixedDigits(ctx, text, x, y) {
  const digit = ctx.measureText("0").width;
  let cx = x;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    const advance = /\d/.test(ch) ? digit : w;
    ctx.fillText(ch, cx + (advance - w) / 2, y);
    cx += advance;
  }
  return cx - x;
}

function scrim(ctx, y0, y1, alpha, hold = 0) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(${scrimRgb},${alpha})`);
  if (hold) g.addColorStop(hold, `rgba(${scrimRgb},${alpha})`);
  g.addColorStop(1, `rgba(${scrimRgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, Math.min(y0, y1), ctx.canvas.width, Math.abs(y1 - y0));
}

function drawChart(ctx, s, o, accent, x, y, w, h, cfg) {
  const values = o.series;
  const max = Math.max(...values);
  const pts = values.map((v, i) => [x + (i / (values.length - 1)) * w, y + h - (v / max) * h]);
  const area = () => {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    for (const [px, py] of pts) ctx.lineTo(px, py);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  };
  const line = () => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  };
  const head = clamp01(o.playhead);
  ctx.save();
  area();
  const ink = inkOf(cfg);
  ctx.fillStyle = ink.base;
  ctx.fill();
  line();
  ctx.strokeStyle = ink.baseLine;
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 4 * s, y - 40 * s, head * w + 4 * s, h + 80 * s);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `${accent}d0`);
  g.addColorStop(1, `${accent}08`);
  area();
  ctx.fillStyle = g;
  ctx.fill();
  line();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3.5 * s;
  ctx.shadowColor = `${accent}80`;
  ctx.shadowBlur = 10 * s;
  ctx.stroke();
  ctx.restore();
  const fi = head * (values.length - 1);
  const i0 = Math.floor(fi);
  const i1 = Math.min(values.length - 1, i0 + 1);
  const px = x + head * w;
  const py = lerp(pts[i0][1], pts[i1][1], fi - i0);
  ctx.fillStyle = ink.faint;
  ctx.fillRect(px - s, py, 2 * s, y + h - py);
  ctx.beginPath();
  ctx.arc(px, py, 7 * s, 0, Math.PI * 2);
  ctx.fillStyle = ink.dot;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 24 * s;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = typeFont(TYPE[cfg.type].label, s);
  ctx.fillStyle = ink.muted;
  o.labels.forEach((label, i) => {
    ctx.textAlign = i === 0 ? "left" : i === o.labels.length - 1 ? "right" : "center";
    ctx.fillText(label, x + (i / (o.labels.length - 1)) * w, y + h + 38 * s);
  });
  ctx.restore();
}

const NYT_INK = { text: "#121212", body: "#333333", muted: "#666666", faint: "#8a8a8a", rule: "#b8b5ae" };

function drawLandmarks(ctx, s, o, cfg, top0, bottom0) {
  const k = ctx.canvas.width / map.getContainer().clientWidth;
  const zoom = map.getZoom();
  const pitch = (map.getPitch() * Math.PI) / 180;
  ctx.font = `600 ${19 * s}px ${FRANKLIN}`;
  ctx.lineJoin = "round";
  for (const m of cfg.landmarks ?? []) {
    const born = clamp01((o.year - m.year - GROW_YEARS) / 2);
    if (born <= 0) continue;
    const ground = map.project(m.lngLat);
    const mpp = (40075016.686 * Math.cos((m.lngLat[1] * Math.PI) / 180)) / (512 * 2 ** zoom);
    const gx = ground.x * k;
    const gy = ground.y * k;
    const top = gy - ((m.h * HEIGHT_SCALE) / mpp) * Math.sin(pitch) * k;
    const tipY = top - 46 * s;
    const text = `${m.name}, ${m.year}`;
    const tw = ctx.measureText(text).width;
    const dir = m.side === "left" ? -1 : 1;
    const tx = dir < 0 ? gx - tw + 8 * s : gx - 8 * s;
    const a = born * clamp01((tipY - 30 * s - top0) / (40 * s)) * clamp01((bottom0 - top) / (40 * s));
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.strokeStyle = NYT_INK.text;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(gx, top);
    ctx.lineTo(gx, tipY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(gx, top, 3.5 * s, 0, Math.PI * 2);
    ctx.fillStyle = NYT_INK.text;
    ctx.fill();
    ctx.strokeStyle = "rgba(240,238,233,0.95)";
    ctx.lineWidth = 7 * s;
    ctx.strokeText(text, tx, tipY - 10 * s);
    ctx.fillStyle = NYT_INK.text;
    ctx.fillText(text, tx, tipY - 10 * s);
  }
  ctx.globalAlpha = 1;
}

function drawBars(ctx, s, o, x, y, w, h) {
  const perYear = buildingStats.perYear;
  const cap = 900;
  const bw = w / perYear.length;
  perYear.forEach((n, i) => {
    const year = buildingStats.minYear + i;
    const bh = (Math.min(n, cap) / cap) * h;
    ctx.fillStyle = year <= o.year ? eraColor(year) : "rgba(18,18,18,0.12)";
    ctx.fillRect(x + i * bw, y + h - bh, Math.max(1, bw - 0.6 * s), bh);
  });
  ctx.fillStyle = NYT_INK.rule;
  ctx.fillRect(x, y + h, w, 1.5 * s);
  ctx.font = `500 ${17 * s}px ${FRANKLIN}`;
  ctx.fillStyle = NYT_INK.muted;
  const { minYear, maxYear } = buildingStats;
  const ticks = [minYear];
  for (let t = Math.ceil((minYear + 1) / 50) * 50; t < maxYear; t += 50) if (t - minYear >= 15 && maxYear - t >= 15) ticks.push(t);
  ticks.push(maxYear);
  for (const tick of ticks) {
    const tx = x + ((tick - minYear + 0.5) / perYear.length) * w;
    ctx.fillStyle = NYT_INK.rule;
    ctx.fillRect(tx - 0.5 * s, y + h, 1 * s, 7 * s);
    ctx.fillStyle = NYT_INK.muted;
    ctx.textAlign = tick === minYear ? "left" : tick === maxYear ? "right" : "center";
    ctx.fillText(String(tick), tick === minYear ? x : tick === maxYear ? x + w : tx, y + h + 30 * s);
  }
  ctx.textAlign = "left";
  const px = x + ((o.year - buildingStats.minYear) / perYear.length) * w;
  ctx.fillStyle = NYT_INK.text;
  ctx.fillRect(px - 0.75 * s, y - 8 * s, 1.5 * s, h + 8 * s);
}

function drawNytOverlay(ctx, s, o, cfg) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const L = { ...format.layout, ...TYPE.nyt.layout?.[formatId] };
  const x = L.x * s;
  ctx.save();
  scrim(ctx, 0, L.topScrim * s, 0.96, 0.74);
  scrim(ctx, H, L.bottomScrim * s, 0.96, 0.62);
  drawLandmarks(ctx, s, o, cfg, (L.stat + 10) * s, (L.chartLabel - 50) * s);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = NYT_INK.text;
  ctx.font = `700 ${L.headSize * s}px ${CHELT}`;
  ctx.letterSpacing = `${-0.4 * s}px`;
  (cfg.headline ?? []).forEach((line, i) => ctx.fillText(line, x, (L.head + i * L.headLead) * s));
  ctx.letterSpacing = "0px";
  if (cfg.dek) {
    ctx.font = `400 ${25 * s}px ${CHELT}`;
    ctx.fillStyle = NYT_INK.body;
    ctx.fillText(cfg.dek, x, L.dek * s);
  }
  ctx.fillStyle = NYT_INK.text;
  ctx.font = `700 ${L.bigSize * s}px ${FRANKLIN}`;
  ctx.letterSpacing = `${-3 * s}px`;
  drawFixedDigits(ctx, o.big, x - 5 * s, L.big * s);
  ctx.letterSpacing = "0px";
  const sw = 16 * s;
  ctx.fillStyle = eraColor(o.year);
  ctx.fillRect(x + 2 * s, L.era * s - sw + 1 * s, sw, sw);
  ctx.font = `700 ${25 * s}px ${FRANKLIN}`;
  ctx.fillStyle = NYT_INK.text;
  ctx.fillText(o.eraLabel, x + sw + 14 * s, L.era * s);
  const lw = ctx.measureText(o.eraLabel).width;
  ctx.font = `400 ${25 * s}px ${FRANKLIN}`;
  ctx.fillStyle = NYT_INK.muted;
  ctx.fillText(`  ${o.eraSpan}`, x + sw + 14 * s + lw, L.era * s);
  ctx.font = `400 ${22 * s}px ${FRANKLIN}`;
  ctx.fillStyle = NYT_INK.body;
  ctx.fillText(`${o.count.toLocaleString()} buildings standing`, x + 2 * s, L.stat * s);
  ctx.font = `600 ${17 * s}px ${FRANKLIN}`;
  ctx.fillStyle = NYT_INK.text;
  ctx.letterSpacing = `${0.3 * s}px`;
  ctx.fillText("New buildings per year", x, L.chartLabel * s);
  ctx.letterSpacing = "0px";
  drawBars(ctx, s, o, x, L.chartY * s, W - 2 * x, L.chartH * s);
  ctx.font = `400 ${15 * s}px ${FRANKLIN}`;
  ctx.fillStyle = NYT_INK.faint;
  ctx.fillText(cfg.source, x, L.credit * s);
  ctx.restore();
}

function drawSpeedKey(ctx, s, right, base, ink, units) {
  const mph = units === "mph";
  const stops = mph ? [12, 20, 30] : [20, 30, 45];
  const seg = 46 * s;
  const gap = 16 * s;
  ctx.font = `500 ${20 * s}px ${GROTESK}`;
  ctx.textAlign = "center";
  const y = base - 12 * s;
  stops.forEach((v, i) => {
    const cx = right - seg / 2 - (stops.length - 1 - i) * (seg + gap);
    ctx.strokeStyle = ink.text;
    ctx.lineCap = "round";
    ctx.lineWidth = speedWidth(mph ? v * 1.609 : v) * s;
    ctx.beginPath();
    ctx.moveTo(cx - seg / 2, y);
    ctx.lineTo(cx + seg / 2, y);
    ctx.stroke();
    ctx.fillStyle = ink.muted;
    ctx.fillText(i === stops.length - 1 ? `${v} ${mph ? "mph" : "km/h"}` : String(v), cx, base + 16 * s);
  });
  ctx.textAlign = "right";
  ctx.fillStyle = ink.body;
  ctx.fillText("Thicker trail = faster train", right, base - 38 * s);
  ctx.textAlign = "left";
}

function drawCallouts(ctx, s, cfg, top0, bottom0, W, accent) {
  const k = ctx.canvas.width / map.getContainer().clientWidth;
  ctx.lineJoin = "round";
  for (const c of cfg.callouts) {
    const pt = map.project(c.lngLat);
    const gx = pt.x * k;
    const gy = pt.y * k;
    const tipY = gy - (c.rise ?? 70) * s;
    ctx.font = `700 ${21 * s}px ${GROTESK}`;
    const w1 = ctx.measureText(c.name).width;
    ctx.font = `500 ${19 * s}px ${GROTESK}`;
    const w2 = ctx.measureText(c.note).width;
    const tw = Math.max(w1, w2);
    const dir = c.side === "left" ? -1 : 1;
    const tx = dir < 0 ? gx - tw + 6 * s : gx - 6 * s;
    const a =
      clamp01((tipY - 50 * s - top0) / (40 * s)) *
      clamp01((bottom0 - gy) / (40 * s)) *
      clamp01((tx - 20 * s) / (30 * s)) *
      clamp01((W - 20 * s - tx - tw) / (30 * s));
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, tipY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(gx, gy, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(6,12,28,0.85)";
    ctx.lineWidth = 6 * s;
    ctx.font = `700 ${21 * s}px ${GROTESK}`;
    ctx.strokeText(c.name, tx, tipY - 34 * s);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(c.name, tx, tipY - 34 * s);
    ctx.font = `500 ${19 * s}px ${GROTESK}`;
    ctx.strokeText(c.note, tx, tipY - 10 * s);
    ctx.fillStyle = accent;
    ctx.fillText(c.note, tx, tipY - 10 * s);
  }
  ctx.globalAlpha = 1;
}

function drawOverlay(ctx, s, o, cfg) {
  if (cfg.type === "nyt") return drawNytOverlay(ctx, s, o, cfg);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const accent = cfg.accent;
  const L = { ...format.layout, ...TYPE[cfg.type].layout?.[formatId] };
  const x = L.x * s;
  ctx.save();
  const lightMap = cfg.look?.ink === "dark";
  scrim(ctx, 0, L.topScrim * s, lightMap ? 0.94 : 0.82, lightMap ? 0.72 : 0);
  scrim(ctx, H, L.bottomScrim * s, lightMap ? 0.94 : 0.78, lightMap ? 0.5 : 0);
  const T = TYPE[cfg.type];
  const ink = inkOf(cfg);
  ctx.textBaseline = "alphabetic";
  if (T.rule) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(x, (L.kicker - 40) * s, W - 2 * x, 2.5 * s);
  }
  ctx.font = typeFont(T.kicker, s);
  ctx.letterSpacing = `${T.kicker.tracking * s}px`;
  ctx.fillStyle = accent;
  ctx.fillText(T.kicker.upper ? city.name.toUpperCase() : city.name, x, L.kicker * s);
  ctx.letterSpacing = `${T.head.tracking * s}px`;
  ctx.font = typeFont(T.head, s, L.headSize * T.head.scale);
  ctx.fillStyle = ink.text;
  ctx.shadowColor = ink.shadow;
  ctx.shadowBlur = 18 * s;
  (cfg.headline ?? []).forEach((line, i) => ctx.fillText(line, x, (L.head + i * L.headLead) * s));
  ctx.letterSpacing = `${T.big.tracking * s}px`;
  ctx.font = typeFont(T.big, s, L.bigSize);
  ctx.shadowColor = ink.shadow;
  ctx.shadowBlur = 28 * s;
  ctx.fillStyle = ink.text;
  const bigW = drawFixedDigits(ctx, o.big, x - 4 * s, L.big * s);
  ctx.shadowBlur = 0;
  ctx.letterSpacing = "0px";
  if (o.suffix) {
    ctx.font = typeFont(T.suffix, s, L.bigSize * 0.28);
    ctx.fillStyle = ink.body;
    ctx.fillText(o.suffix, x + bigW + 14 * s, L.big * s);
  }
  if (o.era) {
    ctx.font = typeFont(T.era, s, L.bigSize * (T.era.scale ?? 0));
    ctx.letterSpacing = `${(T.era.tracking ?? 0) * s}px`;
    ctx.fillStyle = T.era.below ? ink.body : accent;
    const era = T.era.upper ? o.era.toUpperCase() : o.era;
    if (T.era.below) ctx.fillText(era, x + 2 * s, L.era * s);
    else ctx.fillText(era, x + bigW + 22 * s, L.big * s);
    ctx.letterSpacing = "0px";
  }
  ctx.font = typeFont(T.stat, s);
  ctx.fillStyle = ink.body;
  ctx.fillText(o.stat, x + 2 * s, L.stat * s);
  const chartW = format.chart === "full" ? W - 2 * x : 560 * s;
  const chartX = format.chart === "full" ? x : W - chartW - x;
  drawChart(ctx, s, o, accent, chartX, L.chartY * s, chartW, L.chartH * s, cfg);
  if (cfg.speedKey) drawSpeedKey(ctx, s, W - x, L.stat * s, ink, cfg.units);
  if (cfg.callouts && params.get("callouts") !== "0") drawCallouts(ctx, s, cfg, (L.big + 40) * s, (L.stat - 90) * s, W, accent);
  ctx.font = typeFont(T.credit, s);
  ctx.fillStyle = ink.faint;
  ctx.fillText(`${o.credit} · © OpenStreetMap, OpenFreeMap`, x + 2 * s, L.credit * s);
  ctx.restore();
}

const acts = { buildings: buildingsAct, transit: transitAct };
let actId = params.get("act") ?? "buildings";
let current = null;

function setAct(id) {
  actId = id;
  current = acts[id];
  current.enter();
  document.getElementById("act").value = id;
}

const stillCam = params.get("cam")?.split(",").map(Number);
const stillP = params.has("p") ? Number(params.get("p")) : null;
const hudOn = params.get("hud") !== "0";

const actDuration = (cfg) => cfg.seconds + (cfg.tease?.seconds ?? 0);
const FLASH = 0.4;

function renderAt(tSeconds, { camera = true } = {}) {
  const cfg = city.acts[actId];
  const tease = cfg.tease?.seconds ?? 0;
  const teasing = tSeconds < tease;
  const t = teasing ? 0 : tSeconds - tease;
  const total = cfg.seconds;
  const pRaw = stillP ?? (teasing ? cfg.tease.p : Math.max(0, (t - LEAD) / (total - LEAD - HOLD)));
  const p = Math.min(1, pRaw);
  if (camera) {
    if (stillCam) {
      const [lng, lat, zoom, pitch, bearing] = stillCam;
      map.jumpTo({ center: [lng, lat], zoom, pitch, bearing, padding: 0 });
    } else {
      const cam = cameraAt(cameraKeys(cfg), clamp01(t / total));
      map.jumpTo({ ...cam, zoom: cam.zoom + format.zoom, padding: { ...format.padding, left: 0, right: 0 } });
    }
  }
  const state = current.update(p, pRaw);
  const s = Math.min(hud.width, hud.height) / 1080;
  hudCtx.clearRect(0, 0, hud.width, hud.height);
  if (hudOn) drawOverlay(hudCtx, s, current.overlay(state), cfg);
  const fadeIn = tease ? 1 : clamp01(t / FADE);
  const fade = Math.min(fadeIn, clamp01((total - t) / FADE));
  const flash = tease && !teasing ? Math.pow(clamp01(1 - t / FLASH), 2) : 0;
  stage.style.opacity = recording ? "1" : String(0.35 + 0.65 * fade);
  return { fade, flash };
}

const grain = (() => {
  const c = document.createElement("canvas");
  c.width = hud.width;
  c.height = hud.height;
  const g = c.getContext("2d");
  const img = g.createImageData(c.width, c.height);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = 128 + ((seed / 2147483647) - 0.5) * 200;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
})();

function composite(octx, src, { fade, flash }) {
  const look = { ...city.acts[actId].look };
  if (params.has("bloom")) look.bloom = Number(params.get("bloom"));
  if (params.has("grain")) look.grain = Number(params.get("grain"));
  const W = octx.canvas.width;
  const H = octx.canvas.height;
  const s = Math.min(W, H) / 1080;
  octx.save();
  octx.fillStyle = BG;
  octx.fillRect(0, 0, W, H);
  octx.globalAlpha = fade;
  octx.filter = `contrast(1.04) saturate(${look.saturate ?? 1})`;
  octx.drawImage(src, 0, 0, W, H);
  octx.globalCompositeOperation = "lighter";
  octx.filter = `contrast(2.2) brightness(0.5) blur(${6 * s}px)`;
  octx.globalAlpha = (look.bloom ?? 0.3) * fade;
  octx.drawImage(src, 0, 0, W, H);
  octx.filter = `contrast(2.2) brightness(0.45) blur(${26 * s}px)`;
  octx.globalAlpha = (look.bloom ?? 0.3) * 1.15 * fade;
  octx.drawImage(src, 0, 0, W, H);
  octx.globalCompositeOperation = "source-over";
  octx.filter = "none";
  octx.globalAlpha = 1;
  if (look.grain) {
    octx.globalCompositeOperation = "soft-light";
    octx.globalAlpha = look.grain;
    octx.drawImage(grain, 0, 0, W, H);
    octx.globalCompositeOperation = "source-over";
    octx.globalAlpha = 1;
  }
  if (wash) {
    const rgb = hexRgb(wash.color).join(",");
    const w = octx.createLinearGradient(0, 0, 0, H * 0.55);
    w.addColorStop(0, `rgba(${rgb},${wash.alpha * fade})`);
    w.addColorStop(1, `rgba(${rgb},0)`);
    octx.globalCompositeOperation = "soft-light";
    octx.fillStyle = w;
    octx.fillRect(0, 0, W, H);
    octx.globalCompositeOperation = "screen";
    octx.globalAlpha = 0.5;
    octx.fillRect(0, 0, W, H);
    octx.globalCompositeOperation = "source-over";
    octx.globalAlpha = 1;
  }
  const v = octx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(${scrimRgb},${look.vignette ?? 0.45})`);
  octx.fillStyle = v;
  octx.fillRect(0, 0, W, H);
  octx.globalAlpha = fade;
  octx.drawImage(hud, 0, 0);
  if (flash > 0) {
    octx.globalAlpha = 0.85 * flash;
    octx.fillStyle = "#fff";
    octx.fillRect(0, 0, W, H);
  }
  octx.restore();
}

let contextLost = false;
map.getCanvas().addEventListener("webglcontextlost", () => (contextLost = true));

async function waitIdle() {
  const deadline = performance.now() + Number(params.get("idle") ?? 15000);
  map.redraw();
  while (!map.loaded() && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 8));
    map.redraw();
  }
  map.redraw();
  if (contextLost) throw new Error("WebGL context lost");
}

async function recordAct(session) {
  const frames = Math.round(actDuration(city.acts[actId]) * fps);
  const out = document.createElement("canvas");
  out.width = hud.width;
  out.height = hud.height;
  const octx = out.getContext("2d");
  const from = Number(params.get("from") ?? 0);
  const to = Math.min(frames, Number(params.get("to") ?? frames));
  const only = params.get("only")?.split(",").map(Number);
  for (const i of only ?? Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k)) {
    let look = renderAt(i / fps);
    await waitIdle();
    if (stillCam) {
      await new Promise((r) => setTimeout(r, 4000));
      look = renderAt(i / fps);
      await waitIdle();
    }
    composite(octx, map.getCanvas(), look);
    const blob = await new Promise((r) => out.toBlob(r, "image/png"));
    const saved = await fetch(`/api/frame/${session}/${i}`, { method: "POST", body: blob });
    if (!saved.ok) throw new Error(`frame ${i} upload failed: ${saved.status}`);
    window.__recordProgress = { act: actId, frame: i + 1, from, to, frames };
  }
  if (only) return { out: "stills" };
  const range = new URLSearchParams({ fps, from: params.get("chunkFrom") ?? from, to });
  const res = await fetch(`/api/encode/${session}?${range}`, { method: "POST" });
  return res.json();
}

setAct(actId);
if (!hudOn) for (const l of map.getStyle().layers) if (l.type === "symbol") map.setLayoutProperty(l.id, "visibility", "none");

if (recording) {
  window.__recordDone = recordAct(params.get("session") ?? `${cityId}-${actId}`).then(
    (r) => (window.__recordResult = r),
    (e) => (window.__recordResult = { error: String(e) }),
  );
} else {
  const playBtn = document.getElementById("play");
  const scrub = document.getElementById("scrub");
  const follow = document.getElementById("follow");
  let playing = true;
  let t = Number(params.get("t") ?? 0);
  let last = performance.now();
  document.getElementById("act").onchange = (e) => {
    setAct(e.target.value);
    t = 0;
  };
  playBtn.onclick = () => {
    playing = !playing;
    playBtn.textContent = playing ? "Pause" : "Play";
  };
  scrub.oninput = () => {
    t = Number(scrub.value) * actDuration(city.acts[actId]);
    renderAt(t, { camera: follow.checked });
  };
  document.getElementById("record").onclick = () => {
    const q = new URLSearchParams({ city: cityId, act: actId, record: "1", format: formatId });
    open(`/?${q}`, "_blank");
  };
  addEventListener("resize", () => {
    sizeStage();
    map.resize();
  });
  function tick(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (playing) {
      t += dt;
      if (t > actDuration(city.acts[actId])) t = 0;
      scrub.value = String(t / actDuration(city.acts[actId]));
      renderAt(t, { camera: follow.checked });
    }
    requestAnimationFrame(tick);
  }
  renderAt(t, { camera: follow.checked });
  requestAnimationFrame(tick);
  window.__ready = true;
}
