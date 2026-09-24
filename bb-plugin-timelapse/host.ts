import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as PImage from "pureimage";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { captionLayout } from "./caption";
import { hostContract } from "./contract";
import type { TimelapseEdit } from "./contract";

async function run(command: string, args: string[], signal: AbortSignal, input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed (${code}): ${stderr}`));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

function project(root: string) {
  const realRoot = fs.realpathSync(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(realRoot, "package.json"), "utf8"));
  if (manifest.name !== "timelapse") throw new Error("Selected folder is not a timelapse project");
  const out = path.join(realRoot, "out");
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  return { root: realRoot, out };
}

function videoFile(root: string, relative: string) {
  const { out } = project(root);
  if (path.isAbsolute(relative) || !relative.endsWith(".mp4")) throw new Error("Expected a video in this timelapse project's out folder");
  const file = fs.realpathSync(path.resolve(out, relative));
  if (!file.startsWith(out + path.sep)) throw new Error("Video is outside the selected project");
  return { out, file };
}

async function probe(file: string, signal: AbortSignal) {
  const raw = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate,nb_frames:format=duration", "-of", "json", file], signal);
  const result = JSON.parse(raw);
  const stream = result.streams?.[0];
  if (!stream) throw new Error("Video has no readable video stream");
  const [numerator, denominator] = String(stream.avg_frame_rate).split("/").map(Number);
  const fps = numerator / denominator;
  const duration = Number(result.format?.duration);
  const width = Number(stream.width);
  const height = Number(stream.height);
  const frames = Number(stream.nb_frames) || Math.round(duration * fps);
  if (![fps, duration, width, height, frames].every((n) => Number.isFinite(n) && n > 0)) throw new Error("Video metadata is invalid");
  return { fps, duration, width, height, frames };
}

function listVideos(root: string) {
  const { out } = project(root);
  const folders = [out, path.join(out, "thread"), path.join(out, "edits")];
  const videos = [];
  for (const folder of folders) {
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) {
      if (!name.endsWith(".mp4")) continue;
      const file = path.join(folder, name);
      if (!fs.statSync(file).isFile()) continue;
      const stat = fs.statSync(file);
      videos.push({ path: path.relative(out, file).split(path.sep).join("/"), bytes: stat.size, modifiedAt: stat.mtimeMs });
    }
  }
  return videos.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 80);
}

let fontLoaded = false;

async function rasterCaption(width: number, height: number, edit: TimelapseEdit, file: string) {
  const layout = captionLayout(width, height, edit);
  if (!layout.lines.length) return false;
  if (!fontLoaded) {
    const fonts = [
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "C:\\Windows\\Fonts\\arialbd.ttf",
    ];
    const fontFile = fonts.find((candidate) => fs.existsSync(candidate));
    if (!fontFile) throw new Error("A bold TrueType font is required to render captions");
    PImage.registerFont(fontFile, "Timelapse").loadSync();
    fontLoaded = true;
  }
  const bitmap = PImage.make(width, height);
  bitmap.data.fill(0);
  const ctx = bitmap.getContext("2d");
  const { boxX, boxY, boxWidth, boxHeight, font, lineHeight, lines, textY } = layout;
  const radius = Math.round(width * 0.016);
  ctx.fillStyle = "rgba(7,11,24,0.82)";
  ctx.beginPath();
  ctx.moveTo(boxX + radius, boxY);
  ctx.lineTo(boxX + boxWidth - radius, boxY);
  ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
  ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
  ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
  ctx.lineTo(boxX + radius, boxY + boxHeight);
  ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
  ctx.lineTo(boxX, boxY + radius);
  ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `${font}px Timelapse`;
  lines.forEach((line, index) => ctx.fillText(line, Math.round((width - ctx.measureText(line).width) / 2), textY + index * lineHeight));
  await PImage.encodePNGToStream(bitmap, fs.createWriteStream(file));
  return true;
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    inspect: async ({ root }) => ({ videos: listVideos(root) }),
    probe: async ({ root, path: relative }, context) => probe(videoFile(root, relative).file, context.signal),
    exportMedia: async ({ root, path: relative, edit, kind, frame }, context) => {
      const { out, file } = videoFile(root, relative);
      const info = await probe(file, context.signal);
      if (edit.startFrame >= edit.endFrame || edit.endFrame > info.frames) throw new Error("Trim range is outside the video");
      if (kind === "still" && (frame === null || frame >= info.frames)) throw new Error("Choose a valid frame for the still");
      const editsDir = path.join(out, "edits");
      fs.mkdirSync(editsDir, { recursive: true });
      const base = `${path.basename(relative, ".mp4").replace(/[^a-z0-9_-]/gi, "-")}-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const extension = kind === "still" ? "png" : "mp4";
      const target = path.join(editsDir, `${base}.${extension}`);
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), "timelapse-caption-"));
      try {
        const overlay = path.join(temp, "caption.png");
        const hasCaption = await rasterCaption(info.width, info.height, edit, overlay);
        const start = kind === "still" ? (frame as number) / info.fps : edit.startFrame / info.fps;
        const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", file];
        if (hasCaption) args.push("-loop", "1", "-i", overlay, "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto[v]", "-map", "[v]");
        if (kind === "still") {
          args.push("-frames:v", "1", target);
        } else {
          args.push("-frames:v", String(edit.endFrame - edit.startFrame), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", target);
        }
        await run("ffmpeg", args, context.signal);
        return { path: path.relative(out, target).split(path.sep).join("/") };
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    },
  },
});
