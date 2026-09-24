# Timelapse BB plugin

Review renders from this repository in BB. Open the Timelapse sidebar page in a thread, enter the absolute path to the `timelapse` project, then choose a video from `out/`. Scrub or step through frames, set a trim, add a caption, and export an MP4 or a still PNG from any frame. Edits are stored per thread and source video. Exports are written to ignored `out/edits/`.

The same operations are available through `bb timelapse` and the bundled agent tools. Run `bb timelapse help` for CLI usage. The plugin uses `ffprobe`, `ffmpeg`, and ImageMagick `magick` on the workspace host for media exports.

Build with `bb plugin build ./bb-plugin-timelapse` and install with `bb plugin install ./bb-plugin-timelapse --yes` from a BB thread in the repository's host environment.
