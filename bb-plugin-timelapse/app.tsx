import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { definePluginApp, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { TimelapseEdit } from "./contract";
import { captionSvg } from "./caption";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Video = { path: string; bytes: number; modifiedAt: number };
type Project = { root: string; videos: Video[]; previewBaseUrl: string };
type Probe = { duration: number; fps: number; width: number; height: number; frames: number };

function mediaUrl(baseUrl: string, relative: string) {
  return `${baseUrl.replace(/\/$/, "")}/${relative.split("/").map(encodeURIComponent).join("/")}`;
}

function videoUrl(threadId: string, path: string) {
  return `/api/v1/plugins/timelapse/http/video?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(path)}`;
}

function ThreadPicker() {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [threads, setThreads] = useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void sdk.threads.list({ limit: 100 }).then((items) => {
      if (active) setThreads(items.map((item) => ({ id: item.id, title: item.title ?? item.titleFallback ?? item.id })));
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [sdk]);

  return (
    <div className="h-full overflow-y-auto bg-background px-4 py-5 text-foreground md:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Timelapse</h1>
        <p className="text-sm text-muted-foreground">Choose a thread to review its timelapse project.</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="space-y-2">
          {threads.map((thread) => (
            <button key={thread.id} type="button" onClick={() => navigate.toPluginPanel("review", { subPath: thread.id })} className="block w-full rounded-lg border border-border p-3 text-left hover:bg-accent">
              <span className="block font-medium">{thread.title}</span>
              <span className="block text-xs text-muted-foreground">{thread.id}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function VideoReview({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const initializedVideoRef = useRef<string | null>(null);
  const videoLoadRef = useRef(0);
  const [rootInput, setRootInput] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [videoPath, setVideoPath] = useState("");
  const [info, setInfo] = useState<Probe | null>(null);
  const [edit, setEdit] = useState<TimelapseEdit | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [exported, setExported] = useState("");

  const loadVideo = useCallback(async (path: string) => {
    if (!threadId) return;
    const loadId = ++videoLoadRef.current;
    setVideoPath(path);
    initializedVideoRef.current = null;
    setInfo(null);
    setEdit(null);
    setPlaying(false);
    setExported("");
    setError("");
    try {
      const [probe, saved] = await Promise.all([
        rpc.call("video_probe", { threadId, path }),
        rpc.call("edit_get", { threadId, path }),
      ]);
      if (videoLoadRef.current !== loadId) return;
      setInfo(probe);
      setEdit(saved);
      setFrame(saved.startFrame);
    } catch (cause) {
      if (videoLoadRef.current === loadId) throw cause;
    }
  }, [rpc, threadId]);

  const refreshProject = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    try {
      const response = await rpc.call("project_get", { threadId });
      setProject(response.project);
      setRootInput(response.project?.root ?? "");
      setError("");
      if (response.project?.videos.length) await loadVideo(response.project.videos[0].path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [loadVideo, rpc, threadId]);

  useEffect(() => { void refreshProject(); }, [refreshProject]);

  useEffect(() => {
    if (!info || !edit || !videoRef.current || initializedVideoRef.current === videoPath) return;
    videoRef.current.currentTime = edit.startFrame / info.fps;
    initializedVideoRef.current = videoPath;
  }, [edit, info, videoPath]);

  const openProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!threadId || !rootInput.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await rpc.call("project_open", { threadId, root: rootInput.trim() });
      setProject(result);
      setMessage(`Opened ${result.videos.length} videos`);
      if (result.videos.length) await loadVideo(result.videos[0].path);
      else { setVideoPath(""); setInfo(null); setEdit(null); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateFrame = (next: number) => {
    if (!info) return;
    const clamped = Math.max(0, Math.min(info.frames - 1, Math.round(next)));
    setFrame(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped / info.fps;
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) { video.pause(); return; }
    try {
      await video.play();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveEdit = async () => {
    if (!threadId || !edit || !videoPath) return;
    setBusy(true);
    setError("");
    try {
      await rpc.call("edit_save", { threadId, path: videoPath, edit });
      setMessage("Edits saved to this video");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const exportMedia = async (kind: "video" | "still") => {
    if (!threadId || !edit || !videoPath || !project) return;
    setBusy(true);
    setError("");
    setMessage(kind === "video" ? "Exporting edited video…" : "Saving still…");
    try {
      const result = await rpc.call("media_export", { threadId, path: videoPath, edit, kind, frame: kind === "still" ? frame : null });
      setProject({ ...project, previewBaseUrl: result.previewBaseUrl });
      setExported(result.path);
      setMessage(kind === "video" ? "Edited video exported" : `Frame ${frame} saved`);
    } catch (cause) {
      setMessage("");
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const selected = project?.videos.find((video) => video.path === videoPath);
  const videoSrc = project && videoPath ? videoUrl(threadId, videoPath) : "";
  const overlay = info && edit?.text.trim() ? captionSvg(info.width, info.height, edit) : "";
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 md:px-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Timelapse</h1>
          <p className="text-sm text-muted-foreground">Review a video frame by frame, add a caption, then export a still or trimmed video.</p>
        </header>
        <form onSubmit={openProject} className="flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1 space-y-1 text-sm">
            <span className="font-medium">Project folder</span>
            <Input value={rootInput} onChange={(event) => setRootInput(event.target.value)} placeholder="/absolute/path/to/timelapse" aria-label="Timelapse project folder" />
          </label>
          <Button type="submit" disabled={busy || !rootInput.trim()}>Open project</Button>
        </form>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        {loading ? <p className="text-sm text-muted-foreground">Loading project…</p> : null}
        {project && !project.videos.length ? <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">No MP4 files in this project's out folder yet. Render a scene, then reopen the project.</p> : null}
        {project && project.videos.length ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="min-w-0 space-y-3" aria-label="Video preview">
              <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-border bg-black" style={info ? { aspectRatio: `${info.width}/${info.height}` } : undefined}>
                <video
                  key={videoSrc}
                  ref={videoRef}
                  src={videoSrc}
                  playsInline
                  preload="metadata"
                  crossOrigin="anonymous"
                  className="block max-h-[72vh] max-w-full"
                  onTimeUpdate={(event) => { if (info) setFrame(Math.min(info.frames - 1, Math.round(event.currentTarget.currentTime * info.fps))); }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
                {overlay ? <img alt="" aria-hidden="true" src={`data:image/svg+xml,${encodeURIComponent(overlay)}`} className="pointer-events-none absolute inset-0 h-full w-full" /> : null}
              </div>
              {info ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Frame {frame.toLocaleString()} of {(info.frames - 1).toLocaleString()}</span><span>{(frame / info.fps).toFixed(2)} s</span></div>
                  <input type="range" min={0} max={info.frames - 1} step={1} value={frame} onChange={(event) => updateFrame(Number(event.target.value))} aria-label="Video frame" className="w-full accent-primary" />
                  <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void togglePlayback()}>{playing ? "Pause" : "Play"}</Button><Button variant="outline" onClick={() => updateFrame(frame - 1)} disabled={frame === 0}>Previous frame</Button><Button variant="outline" onClick={() => updateFrame(frame + 1)} disabled={frame >= info.frames - 1}>Next frame</Button></div>
                </div>
              ) : <p className="text-sm text-muted-foreground">Loading video…</p>}
            </section>
            <aside className="space-y-4" aria-label="Video editing controls">
              <label className="block space-y-1 text-sm"><span className="font-medium">Video</span><select value={videoPath} onChange={(event) => void loadVideo(event.target.value).catch((cause) => setError(String(cause)))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">{project.videos.map((video) => <option key={video.path} value={video.path}>{video.path}</option>)}</select></label>
              {selected ? <p className="break-all text-xs text-muted-foreground">{(selected.bytes / 1024 / 1024).toFixed(1)} MB · {videoPath}</p> : null}
              {info && edit ? (
                <>
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">Trim</p>
                    <label className="block space-y-1 text-xs text-muted-foreground">Start frame<Input type="number" min={0} max={edit.endFrame - 1} value={edit.startFrame} onChange={(event) => setEdit({ ...edit, startFrame: Number(event.target.value) })} /></label>
                    <label className="block space-y-1 text-xs text-muted-foreground">End frame<Input type="number" min={edit.startFrame + 1} max={info.frames} value={edit.endFrame} onChange={(event) => setEdit({ ...edit, endFrame: Number(event.target.value) })} /></label>
                    <p className="text-xs text-muted-foreground">{((edit.endFrame - edit.startFrame) / info.fps).toFixed(1)} seconds at {info.fps.toFixed(2)} fps</p>
                  </div>
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <label className="block space-y-1 text-sm"><span className="font-medium">Caption</span><textarea value={edit.text} onChange={(event) => setEdit({ ...edit, text: event.target.value.slice(0, 220) })} rows={3} maxLength={220} placeholder="Add a short observation" className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
                    <label className="block space-y-1 text-xs text-muted-foreground">Position<select value={edit.position} onChange={(event) => setEdit({ ...edit, position: event.target.value as TimelapseEdit["position"] })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="top">Upper map</option><option value="middle">Center map</option><option value="bottom">Lower map</option></select></label>
                  </div>
                  <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || edit.startFrame >= edit.endFrame} onClick={() => void saveEdit()}>Save edits</Button><Button variant="outline" disabled={busy || edit.startFrame >= edit.endFrame} onClick={() => void exportMedia("still")}>Save still</Button><Button disabled={busy || edit.startFrame >= edit.endFrame} onClick={() => void exportMedia("video")}>Export video</Button></div>
                </>
              ) : null}
              {exported && project ? <a href={mediaUrl(project.previewBaseUrl, exported)} target="_blank" rel="noreferrer" className="block break-all text-sm text-primary underline">Open {exported}</a> : null}
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "review", title: "Timelapse", icon: "Film", path: "review", component: ({ subPath }) => subPath ? <VideoReview key={subPath} threadId={subPath} /> : <ThreadPicker /> });
  app.slots.threadPanelAction({ id: "review", title: "Timelapse", icon: "Film", layout: "flush", component: ({ threadId }) => <VideoReview threadId={threadId} /> });
});
