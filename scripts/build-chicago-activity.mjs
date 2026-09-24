import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "public/data/chicago");
const stopsFile = path.join(root, "data/raw/cta_gtfs/stops.txt");
const tripDay = "2019-09-18";

function csvRows(input) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted && ch === '"' && input[i + 1] === '"') {
      value += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && (ch === "," || ch === "\n")) {
      row.push(value.replace(/\r$/, ""));
      value = "";
      if (ch === "\n") {
        rows.push(row);
        row = [];
      }
    } else {
      value += ch;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

async function getRows(dataset, query) {
  const url = new URL(`https://data.cityofchicago.org/resource/${dataset}.json`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${dataset}: HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`${dataset}: expected rows`);
  return rows;
}

function writeJson(name, value) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(value));
}

if (!fs.existsSync(stopsFile)) throw new Error("CTA GTFS stops.txt missing; run npm run fetch:chicago first");
const [stopHeader, ...stopRows] = csvRows(fs.readFileSync(stopsFile, "utf8"));
const stopIndex = Object.fromEntries(stopHeader.map((name, index) => [name, index]));
const stations = new Map();
for (const row of stopRows) {
  if (row[stopIndex.location_type] !== "1") continue;
  const id = row[stopIndex.stop_id];
  const lat = Number(row[stopIndex.stop_lat]);
  const lon = Number(row[stopIndex.stop_lon]);
  if (id && Number.isFinite(lat) && Number.isFinite(lon)) stations.set(id, [lon, lat]);
}

const ridershipRows = await getRows("t2rn-p8d7", {
  $select: "station_id,stationame,month_beginning,avg_weekday_rides",
  $where: "month_beginning between '2019-01-01T00:00:00' and '2021-12-01T00:00:00'",
  $order: "month_beginning,station_id",
  $limit: "50000",
});
if (ridershipRows.length >= 50000) throw new Error("CTA ridership query may be truncated");
const months = [...new Set(ridershipRows.map((row) => row.month_beginning.slice(0, 7)))];
const stationEntries = new Map();
for (const row of ridershipRows) {
  const coord = stations.get(String(row.station_id));
  const rides = Number(row.avg_weekday_rides);
  if (!coord || !Number.isFinite(rides) || rides < 0) continue;
  const entry = stationEntries.get(row.station_id) ?? {
    id: String(row.station_id), name: row.stationame, coord, values: Array(months.length).fill(null),
  };
  entry.values[months.indexOf(row.month_beginning.slice(0, 7))] = Math.round(rides);
  stationEntries.set(row.station_id, entry);
}
if (months.length !== 36 || stationEntries.size < 100) throw new Error(`Unexpected CTA coverage: ${months.length} months, ${stationEntries.size} stations`);
writeJson("ridership.json", {
  source: "City of Chicago CTA monthly station entries, average weekday rides",
  dataset: "https://data.cityofchicago.org/d/t2rn-p8d7",
  months,
  stations: [...stationEntries.values()],
});

const divvyRows = await getRows("fg6s-gzvg", {
  $select: "start_time,from_latitude,from_longitude,to_latitude,to_longitude",
  $where: `start_time between '${tripDay}T00:00:00' and '2019-09-19T00:00:00'`,
  $order: "start_time",
  $limit: "50000",
});
if (divvyRows.length >= 50000) throw new Error("Divvy trip query may be truncated");
const grid = 0.01;
const groups = new Map();
const hourlyTrips = Array(24).fill(0);
let usable = 0;
for (const row of divvyRows) {
  const coords = [Number(row.from_longitude), Number(row.from_latitude), Number(row.to_longitude), Number(row.to_latitude)];
  if (coords.some((n) => !Number.isFinite(n)) || coords[0] < -88 || coords[2] < -88 || coords[1] < 41.6 || coords[3] < 41.6) continue;
  const hour = Number(row.start_time.slice(11, 13));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
  const cells = coords.map((n) => Math.round(n / grid));
  const key = `${hour}|${cells.join("|")}`;
  const group = groups.get(key) ?? { hour, from: [cells[0] * grid, cells[1] * grid], to: [cells[2] * grid, cells[3] * grid], count: 0 };
  group.count++;
  groups.set(key, group);
  usable++;
  hourlyTrips[hour]++;
}
if (usable < 5000) throw new Error(`Unexpected Divvy coverage: ${usable} trips`);
const flows = [...groups.values()].filter((flow) => flow.from[0] !== flow.to[0] || flow.from[1] !== flow.to[1]);
writeJson("divvy.json", {
  source: "City of Chicago Divvy Trips; origin–destination connections, not traveled routes",
  dataset: "https://data.cityofchicago.org/d/fg6s-gzvg",
  day: tripDay,
  tripCount: usable,
  gridDegrees: grid,
  hourlyTrips,
  flows,
});
console.log(`CTA: ${months.length} months, ${stationEntries.size} stations; Divvy: ${usable} trips, ${flows.length} flows`);
