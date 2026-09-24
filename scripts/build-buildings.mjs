import fs from "node:fs";
import path from "node:path";

const cityId = process.argv[2] ?? "nyc";
const root = path.resolve(import.meta.dirname, "..");
const city = JSON.parse(fs.readFileSync(path.join(root, "cities", `${cityId}.json`), "utf8"));
const cfg = city.buildings;
const toMeters = cfg.heightUnit === "ft" ? 0.3048 : 1;

const round = (n) => Math.round(n * 1e6) / 1e6;
const roundRing = (ring) => ring.map(([x, y]) => [round(x), round(y)]);

const raw = JSON.parse(fs.readFileSync(path.join(root, cfg.raw), "utf8"));
const [minYear, maxYear] = cfg.yearRange;
const features = [];
let dropped = 0;

for (const f of raw.features) {
  const rawYear = Number.parseInt(f.properties[cfg.yearField ?? "construction_year"], 10);
  const dated = Number.isFinite(rawYear) && rawYear >= 1600;
  const year = dated ? rawYear : 0;
  const height = cfg.storiesField
    ? (Number.parseFloat(f.properties[cfg.storiesField]) || cfg.defaultStories || 0) * (cfg.floorHeight ?? 3.7)
    : Number.parseFloat(f.properties[cfg.heightField ?? "height_roof"]) * toMeters;
  if ((!dated && !cfg.keepUndated) || !Number.isFinite(height) || height <= 0 || !f.geometry) {
    dropped++;
    continue;
  }
  const g = f.geometry;
  const coordinates =
    g.type === "MultiPolygon" ? g.coordinates.map((p) => p.map(roundRing)) : g.coordinates.map(roundRing);
  features.push({
    type: "Feature",
    properties: { y: dated ? Math.max(year, minYear) : 0, h: Math.round(height * 10) / 10 },
    geometry: { type: g.type, coordinates },
  });
}

features.sort((a, b) => a.properties.y - b.properties.y);

const outDir = path.join(root, "public", "data", cityId);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "buildings.geojson"), JSON.stringify({ type: "FeatureCollection", features }));

const perYear = new Array(maxYear - minYear + 1).fill(0);
for (const f of features) {
  const i = f.properties.y - minYear;
  if (i >= 0 && i < perYear.length) perYear[i]++;
}
fs.writeFileSync(path.join(outDir, "buildings-stats.json"), JSON.stringify({ minYear, maxYear, perYear }));

console.log(`buildings: kept ${features.length} (${features.filter((f) => f.properties.y === 0).length} undated), dropped ${dropped}`);
