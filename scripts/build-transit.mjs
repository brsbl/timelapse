import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const cityId = process.argv[2] ?? "nyc";
const root = path.resolve(import.meta.dirname, "..");
const city = JSON.parse(fs.readFileSync(path.join(root, "cities", `${cityId}.json`), "utf8"));
const cfg = city.transit;
const gtfsDir = path.join(root, cfg.gtfsDir);

function readCsv(name) {
  const text = fs.readFileSync(path.join(gtfsDir, name), "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

async function eachCsvRow(name, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(gtfsDir, name)), crlfDelay: Infinity });
  let header = null;
  for await (const raw of rl) {
    const line = header ? raw : raw.replace(/^\uFEFF/, "");
    if (!line) continue;
    const cells = splitCsvLine(line);
    if (!header) {
      header = cells;
      continue;
    }
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    fn(row);
  }
}

function activeServices(date) {
  const ids = new Set();
  const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`).getUTCDay()
  ];
  if (fs.existsSync(path.join(gtfsDir, "calendar.txt"))) {
    for (const c of readCsv("calendar.txt")) if (c[day] === "1" && c.start_date <= date && c.end_date >= date) ids.add(c.service_id);
  }
  if (fs.existsSync(path.join(gtfsDir, "calendar_dates.txt"))) {
    for (const c of readCsv("calendar_dates.txt")) {
      if (c.date !== date) continue;
      if (c.exception_type === "1") ids.add(c.service_id);
      if (c.exception_type === "2") ids.delete(c.service_id);
    }
  }
  return ids;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const toSeconds = (hms) => {
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};

const R = 6371000;
const toRad = Math.PI / 180;
function dist([lon1, lat1], [lon2, lat2]) {
  const x = (lon2 - lon1) * toRad * Math.cos(((lat1 + lat2) / 2) * toRad);
  const y = (lat2 - lat1) * toRad;
  return Math.sqrt(x * x + y * y) * R;
}

function projectOnSegment(p, a, b) {
  const kx = Math.cos(p[1] * toRad);
  const ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1], px = p[0] * kx, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx, qy = ay + t * dy;
  return { t, d2: (qx - px) ** 2 + (qy - py) ** 2 };
}

const routeTypes = cfg.routeTypes ? new Set(cfg.routeTypes.map(String)) : null;
const routes = new Map(readCsv("routes.txt").filter((r) => !routeTypes || routeTypes.has(r.route_type)).map((r) => [r.route_id, r]));
const stops = new Map(readCsv("stops.txt").map((s) => [s.stop_id, [Number(s.stop_lon), Number(s.stop_lat)]]));

const serviceIds = cfg.serviceDate ? activeServices(cfg.serviceDate) : new Set(cfg.serviceIds);
const trips = readCsv("trips.txt").filter((t) => serviceIds.has(t.service_id) && routes.has(t.route_id));
const tripIds = new Set(trips.map((t) => t.trip_id));
const shapeIds = new Set(trips.map((t) => t.shape_id).filter(Boolean));

const shapePts = new Map();
await eachCsvRow("shapes.txt", (r) => {
  if (!shapeIds.has(r.shape_id)) return;
  if (!shapePts.has(r.shape_id)) shapePts.set(r.shape_id, []);
  shapePts.get(r.shape_id).push([Number(r.shape_pt_sequence), Number(r.shape_pt_lon), Number(r.shape_pt_lat)]);
});

const stopTimes = new Map();
await eachCsvRow("stop_times.txt", (r) => {
  if (!tripIds.has(r.trip_id)) return;
  if (!stopTimes.has(r.trip_id)) stopTimes.set(r.trip_id, []);
  stopTimes.get(r.trip_id).push(r);
});

const shapes = [];
const shapeIndex = new Map();

function addShape(key, coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  const idx = shapes.length;
  shapes.push({ coords, cum });
  shapeIndex.set(key, idx);
  return idx;
}

function shapeFor(trip, seq) {
  const pts = trip.shape_id && shapePts.get(trip.shape_id);
  if (pts && pts.length > 1) {
    if (shapeIndex.has(trip.shape_id)) return shapeIndex.get(trip.shape_id);
    const coords = pts.sort((a, b) => a[0] - b[0]).map(([, lon, lat]) => [lon, lat]);
    return addShape(trip.shape_id, coords);
  }
  const key = "stops:" + seq.map((s) => s.stop_id).join(">");
  if (shapeIndex.has(key)) return shapeIndex.get(key);
  return addShape(key, seq.map((s) => stops.get(s.stop_id)));
}

function locateStops(shape, coordsSeq) {
  const out = [];
  let seg = 0;
  for (const p of coordsSeq) {
    let best = { seg, t: 0, d2: Infinity };
    for (let i = seg; i < shape.coords.length - 1; i++) {
      const r = projectOnSegment(p, shape.coords[i], shape.coords[i + 1]);
      if (r.d2 < best.d2) best = { seg: i, t: r.t, d2: r.d2 };
    }
    seg = best.seg;
    const segLen = shape.cum[seg + 1] - shape.cum[seg];
    out.push(shape.cum[seg] + best.t * segLen);
  }
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1]);
  return out;
}

const routeColors = {};
const outTrips = [];
let skipped = 0;

for (const trip of trips) {
  const seq = (stopTimes.get(trip.trip_id) ?? []).sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  const coordsSeq = seq.map((s) => stops.get(s.stop_id));
  if (seq.length < 2 || coordsSeq.some((c) => !c)) {
    skipped++;
    continue;
  }
  const shapeIdx = shapeFor(trip, seq);
  const dists = locateStops(shapes[shapeIdx], coordsSeq);
  const stamps = [];
  for (let i = 0; i < seq.length; i++) {
    const arr = toSeconds(seq[i].arrival_time || seq[i].departure_time);
    const dep = toSeconds(seq[i].departure_time || seq[i].arrival_time);
    const d = Math.round(dists[i]);
    stamps.push(d, arr);
    if (dep > arr) stamps.push(d, dep);
  }
  const route = routes.get(trip.route_id);
  routeColors[trip.route_id] = "#" + (route?.route_color || "888888");
  outTrips.push({ r: trip.route_id, s: shapeIdx, p: stamps });
}

outTrips.sort((a, b) => a.p[1] - b.p[1]);

const outDir = path.join(root, "public", "data", cityId);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "transit.json"),
  JSON.stringify({
    label: cfg.label,
    routeColors,
    shapes: shapes.map((s) => ({
      c: s.coords.flatMap(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]),
      d: s.cum.map((v) => Math.round(v)),
    })),
    trips: outTrips,
  }),
);

console.log(`transit: ${outTrips.length} trips, ${shapes.length} shapes, skipped ${skipped}`);
