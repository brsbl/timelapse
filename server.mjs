import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = import.meta.dirname;
const port = Number(process.env.PORT ?? 5177);
const mounts = [
  ["/vendor/", path.join(root, "node_modules/maplibre-gl/dist")],
  ["/fonts/franklin/", path.join(root, "node_modules/@fontsource/libre-franklin/files")],
  ["/fonts/", path.join(root, "node_modules/geist/dist/fonts")],
  ["/cities/", path.join(root, "cities")],
  ["/videos/", path.join(root, "out")],
  ["/", path.join(root, "public")],
];
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".geojson": "application/json",
  ".map": "application/json",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};

const safeName = (s) => s.replace(/[^a-z0-9_-]/gi, "");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    return (await import("ffmpeg-static")).default;
  } catch {
    return "ffmpeg";
  }
}

async function encode(dir, fps, from, to) {
  const bin = await ffmpegPath();
  return new Promise((resolve, reject) => {
    const out = path.join(dir, "..", `${path.basename(dir)}_${String(from).padStart(5, "0")}-${String(to).padStart(5, "0")}.mp4`);
    const ff = spawn(bin, [
      "-y", "-framerate", String(fps), "-start_number", String(from), "-i", path.join(dir, "frame_%05d.png"),
      "-frames:v", String(to - from),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", out,
    ]);
    let log = "";
    ff.stderr.on("data", (d) => (log += d));
    ff.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(log.slice(-2000)))));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    const frame = url.pathname.match(/^\/api\/frame\/([^/]+)\/(\d+)$/);
    if (req.method === "POST" && frame) {
      const dir = path.join(root, "out", safeName(frame[1]));
      fs.mkdirSync(dir, { recursive: true });
      const body = await readBody(req);
      fs.writeFileSync(path.join(dir, `frame_${frame[2].padStart(5, "0")}.png`), body);
      res.writeHead(204).end();
      return;
    }
    const enc = url.pathname.match(/^\/api\/encode\/([^/]+)$/);
    if (req.method === "POST" && enc) {
      const dir = path.join(root, "out", safeName(enc[1]));
      const q = (k, d) => Number(url.searchParams.get(k) ?? d);
      const out = await encode(dir, q("fps", 30), q("from", 0), q("to", 0));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ out }));
      return;
    }
    for (const [prefix, dir] of mounts) {
      if (!url.pathname.startsWith(prefix)) continue;
      let file = path.join(dir, decodeURIComponent(url.pathname.slice(prefix.length)));
      if (!file.startsWith(dir)) break;
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.existsSync(file)) continue;
      const type = types[path.extname(file)] ?? "application/octet-stream";
      const size = fs.statSync(file).size;
      const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      if (range) {
        const start = range[1] ? Number(range[1]) : size - Number(range[2]);
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1, "cache-control": "no-cache" });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size, "cache-control": "no-cache" });
      fs.createReadStream(file).pipe(res);
      return;
    }
    res.writeHead(404).end("not found");
  } catch (err) {
    res.writeHead(500).end(String(err?.stack ?? err));
  }
});

server.listen(port, "127.0.0.1", () => console.log(`city-timelapse on http://localhost:${port}`));
