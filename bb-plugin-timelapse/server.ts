import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { editSchema, hostContract, probeSchema, videoSchema } from "./contract";
import type { TimelapseEdit } from "./contract";

const threadInput = z.object({ threadId: z.string().min(1) }).strict();
const projectSchema = z.object({
  root: z.string(),
  videos: z.array(videoSchema),
  previewBaseUrl: z.string(),
}).strict();
const videoInput = threadInput.extend({ path: z.string().min(1) }).strict();

export const rpcContract = defineRpcContract({
  project_get: { input: threadInput, output: z.object({ project: projectSchema.nullable() }).strict() },
  project_open: { input: threadInput.extend({ root: z.string().min(1) }).strict(), output: projectSchema },
  video_probe: { input: videoInput, output: probeSchema },
  edit_get: { input: videoInput, output: editSchema },
  edit_save: { input: videoInput.extend({ edit: editSchema }).strict(), output: editSchema },
  media_export: {
    input: videoInput.extend({ edit: editSchema, kind: z.enum(["video", "still"]), frame: z.number().int().min(0).nullable() }).strict(),
    output: z.object({ path: z.string(), previewBaseUrl: z.string() }).strict(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const videoChunkSize = 1024 * 1024;

  async function contextFor(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId) {
      const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
      if (!environment.hostId) throw new Error("Workspace host is unavailable");
      return { hostId: environment.hostId };
    }
    const project = await bb.sdk.projects.get({ projectId: thread.projectId });
    const source = project.sources.find((item) => item.isDefault && item.type === "local_path");
    if (!source) throw new Error("This thread has no workspace host");
    return { hostId: source.hostId };
  }

  async function savedRoot(threadId: string) {
    return (await bb.storage.kv.get<string>(`project:${threadId}`)) ?? null;
  }

  async function project(threadId: string, root: string) {
    const { hostId } = await contextFor(threadId);
    const [{ videos }, preview] = await Promise.all([
      host.call("inspect", { root }, { hostId }),
      bb.sdk.files.createPreview({ hostId, rootPath: `${root.replace(/\/$/, "")}/out`, ttlMs: 10 * 60 * 1000 }),
    ]);
    return { root, videos, previewBaseUrl: preview.baseUrl };
  }

  async function requireProject(threadId: string) {
    const root = await savedRoot(threadId);
    if (!root) throw new Error("Open a timelapse project first");
    const { hostId } = await contextFor(threadId);
    return { root, hostId };
  }

  async function probeVideo(threadId: string, path: string) {
    const { root, hostId } = await requireProject(threadId);
    return host.call("probe", { root, path }, { hostId });
  }

  async function getEdit(threadId: string, path: string): Promise<TimelapseEdit> {
    const info = await probeVideo(threadId, path);
    const previous = await bb.storage.kv.get<TimelapseEdit>(`edit:${threadId}:${path}`);
    if (previous) {
      const parsed = editSchema.safeParse(previous);
      if (parsed.success && parsed.data.startFrame < parsed.data.endFrame && parsed.data.endFrame <= info.frames) return parsed.data;
    }
    return { startFrame: 0, endFrame: info.frames, text: "", position: "middle" };
  }

  async function saveEdit(threadId: string, path: string, edit: TimelapseEdit) {
    const info = await probeVideo(threadId, path);
    if (edit.startFrame >= edit.endFrame || edit.endFrame > info.frames) throw new Error("Trim range is outside the video");
    await bb.storage.kv.set(`edit:${threadId}:${path}`, edit);
    return edit;
  }

  async function exportMedia(threadId: string, path: string, edit: TimelapseEdit, kind: "video" | "still", frame: number | null) {
    const { root, hostId } = await requireProject(threadId);
    await saveEdit(threadId, path, edit);
    const result = await host.call("exportMedia", { root, path, edit, kind, frame }, { hostId, timeoutMs: 15 * 60 * 1000 });
    const preview = await bb.sdk.files.createPreview({ hostId, rootPath: `${root.replace(/\/$/, "")}/out`, ttlMs: 10 * 60 * 1000 });
    return { path: result.path, previewBaseUrl: preview.baseUrl };
  }

  bb.http.route("GET", "/video", async (context) => {
    const url = new URL(context.req.url);
    const threadId = url.searchParams.get("threadId");
    const path = url.searchParams.get("path");
    if (!threadId || !path) return new Response("Choose a thread and video", { status: 400 });
    try {
      const { root, hostId } = await requireProject(threadId);
      const range = context.req.header("range");
      const match = range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range && !match) return new Response("Unsupported byte range", { status: 416 });
      const start = match ? Number(match[1]) : 0;
      const requestedEnd = match?.[2] ? Number(match[2]) : null;
      if (!Number.isSafeInteger(start) || requestedEnd !== null && (!Number.isSafeInteger(requestedEnd) || requestedEnd < start)) return new Response("Invalid byte range", { status: 416 });
      const first = await host.call("readVideo", { root, path, start, length: videoChunkSize }, { hostId });
      if (start >= first.total) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${first.total}` } });
      const end = Math.min(first.total - 1, requestedEnd ?? first.total - 1, start + videoChunkSize - 1);
      const bytes = Buffer.from(first.content, "base64").subarray(0, end - start + 1);
      const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (range) headers.set("Content-Range", `bytes ${start}-${start + bytes.length - 1}/${first.total}`);
      if (range) return new Response(new Uint8Array(bytes), { status: 206, headers });
      headers.set("Content-Length", String(first.total));
      let offset = bytes.length;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (offset === bytes.length) controller.enqueue(new Uint8Array(bytes));
          if (offset >= first.total) { controller.close(); return; }
          const chunk = await host.call("readVideo", { root, path, start: offset, length: videoChunkSize }, { hostId });
          const data = Buffer.from(chunk.content, "base64");
          if (!data.length) { controller.error(new Error("Video ended unexpectedly")); return; }
          offset += data.length;
          controller.enqueue(new Uint8Array(data));
        },
      });
      return new Response(stream, { headers });
    } catch (cause) {
      return new Response(cause instanceof Error ? cause.message : String(cause), { status: 400 });
    }
  });

  bb.rpc.register(rpcContract, {
    project_get: async ({ threadId }) => {
      const root = await savedRoot(threadId);
      return { project: root ? await project(threadId, root) : null };
    },
    project_open: async ({ threadId, root }) => {
      const normalized = root.trim();
      if (!normalized.startsWith("/")) throw new Error("Enter an absolute project folder path");
      const result = await project(threadId, normalized);
      await bb.storage.kv.set(`project:${threadId}`, normalized);
      return result;
    },
    video_probe: ({ threadId, path }) => probeVideo(threadId, path),
    edit_get: ({ threadId, path }) => getEdit(threadId, path),
    edit_save: ({ threadId, path, edit }) => saveEdit(threadId, path, edit),
    media_export: ({ threadId, path, edit, kind, frame }) => exportMedia(threadId, path, edit, kind, frame),
  });

  bb.agents.registerTool({
    name: "timelapse_inspect",
    description: "List rendered timelapse videos and inspect a selected video's frame count and saved edits.",
    parameters: z.object({ path: z.string().optional() }).strict(),
    async execute({ path }, { threadId }) {
      if (!threadId) throw new Error("Open a bb thread first");
      if (path) {
        const [info, edit] = await Promise.all([probeVideo(threadId, path), getEdit(threadId, path)]);
        return JSON.stringify({ path, ...info, edit });
      }
      const root = await savedRoot(threadId);
      if (!root) throw new Error("Open a project with bb timelapse open first");
      return JSON.stringify(await project(threadId, root));
    },
  });

  bb.agents.registerTool({
    name: "timelapse_export",
    description: "Save a still from an exact frame or export a video using its saved trim and caption edits.",
    parameters: z.object({ path: z.string().min(1), kind: z.enum(["still", "video"]), frame: z.number().int().min(0).optional() }).strict(),
    async execute({ path, kind, frame }, { threadId }) {
      if (!threadId) throw new Error("Open a bb thread first");
      if (kind === "still" && frame === undefined) throw new Error("Choose a frame number");
      const edit = await getEdit(threadId, path);
      return JSON.stringify(await exportMedia(threadId, path, edit, kind, kind === "still" ? frame ?? null : null));
    },
  });

  const usage = [
    "bb timelapse open <absolute-project-folder>",
    "bb timelapse list",
    "bb timelapse show <video-path>",
    "bb timelapse edit <video-path> --text <caption> [--position top|middle|bottom] [--start <frame>] [--end <frame>]",
    "bb timelapse still <video-path> <frame>",
    "bb timelapse export <video-path>",
  ].join("\n");

  bb.cli.register({
    name: "timelapse",
    summary: "Review timelapse videos, edit captions, and export videos or stills",
    commands: [
      { name: "open", summary: "Open a timelapse project for this thread", usage: "bb timelapse open <absolute-project-folder>" },
      { name: "list", summary: "List videos in the open project", usage: "bb timelapse list" },
      { name: "show", summary: "Show a video's metadata and saved edit", usage: "bb timelapse show <video-path>" },
      { name: "edit", summary: "Save trim and caption edits", usage: "bb timelapse edit <video-path> --text <caption> [--position top|middle|bottom] [--start <frame>] [--end <frame>]" },
      { name: "still", summary: "Export a chosen frame as a still image", usage: "bb timelapse still <video-path> <frame>" },
      { name: "export", summary: "Export the trimmed and captioned video", usage: "bb timelapse export <video-path>" },
    ],
    async run(argv, ctx) {
      const threadId = ctx.threadId;
      if (!threadId) return { exitCode: 1, stderr: "Run this command from a bb thread with a workspace." };
      try {
        const [command, path, ...rest] = argv;
        if (!command || command === "help" || command === "--help") return { exitCode: 0, stdout: usage };
        if (command === "open" && path && rest.length === 0) {
          const normalized = path.trim();
          if (!normalized.startsWith("/")) throw new Error("Project folder must be absolute");
          const result = await project(threadId, normalized);
          await bb.storage.kv.set(`project:${threadId}`, normalized);
          return { exitCode: 0, stdout: `Opened ${result.root} (${result.videos.length} videos)` };
        }
        if (command === "list" && !path) {
          const root = await savedRoot(threadId);
          if (!root) throw new Error("Open a timelapse project first");
          const result = await project(threadId, root);
          return { exitCode: 0, stdout: result.videos.map((video) => video.path).join("\n") || "No videos yet" };
        }
        if (command === "show" && path && rest.length === 0) {
          const [info, edit] = await Promise.all([probeVideo(threadId, path), getEdit(threadId, path)]);
          return { exitCode: 0, stdout: JSON.stringify({ path, ...info, edit }, null, 2) };
        }
        if (command === "edit" && path) {
          const edit = await getEdit(threadId, path);
          for (let i = 0; i < rest.length; i += 2) {
            const flag = rest[i];
            const value = rest[i + 1];
            if (value === undefined) throw new Error(`Missing value for ${flag}`);
            if (flag === "--text") edit.text = value;
            else if (flag === "--position" && ["top", "middle", "bottom"].includes(value)) edit.position = value as TimelapseEdit["position"];
            else if (flag === "--start" && /^\d+$/.test(value)) edit.startFrame = Number(value);
            else if (flag === "--end" && /^\d+$/.test(value)) edit.endFrame = Number(value);
            else throw new Error(`Unknown or invalid option: ${flag}`);
          }
          await saveEdit(threadId, path, edit);
          return { exitCode: 0, stdout: JSON.stringify(edit) };
        }
        if (command === "still" && path && rest.length === 1 && /^\d+$/.test(rest[0])) {
          const edit = await getEdit(threadId, path);
          const result = await exportMedia(threadId, path, edit, "still", Number(rest[0]));
          return { exitCode: 0, stdout: `${(await savedRoot(threadId))}/out/${result.path}` };
        }
        if (command === "export" && path && rest.length === 0) {
          const edit = await getEdit(threadId, path);
          const result = await exportMedia(threadId, path, edit, "video", null);
          return { exitCode: 0, stdout: `${(await savedRoot(threadId))}/out/${result.path}` };
        }
        return { exitCode: 1, stderr: usage };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
