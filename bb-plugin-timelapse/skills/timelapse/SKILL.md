---
name: timelapse
summary: Review rendered timelapse scenes, save exact frames, and export captions or trims through the Timelapse plugin.
---

# Timelapse

Use this skill when working with a `timelapse` project and the user wants to inspect, edit, or export a rendered video.

1. Run `bb timelapse open <absolute-project-folder>` from the owning thread. The project must have `package.json` with `name: "timelapse"` and videos under `out/`.
2. Use `bb timelapse list` and `bb timelapse show <video-path>` to find the frame rate, dimensions, and frame count. Video paths are relative to `out/`.
3. Review the clip in the plugin's Timelapse sidebar page. Seek by frame, use Previous and Next frame for precise still selection, and enter trim endpoints as frame numbers. Caption edits remain on the selected video in the thread.
4. Run `bb timelapse edit <video-path> --text <caption> --position top|middle|bottom --start <frame> --end <frame>` to make the same edits from the CLI. The end frame is exclusive.
5. Run `bb timelapse still <video-path> <frame>` for an exact-frame PNG, or `bb timelapse export <video-path>` for an MP4. Outputs go to the project's ignored `out/edits/` folder. Inspect the exported result before presenting it.

The plugin also exposes `timelapse_inspect` and `timelapse_export` tools to agents. Do not describe Divvy connection arcs as traveled paths: the public trip data provides endpoints, not recorded routes.
