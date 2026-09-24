import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const editSchema = z.object({
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().positive(),
  text: z.string().max(220),
  position: z.enum(["top", "middle", "bottom"]),
}).strict();

export type TimelapseEdit = z.infer<typeof editSchema>;

export const videoSchema = z.object({
  path: z.string(),
  bytes: z.number().nonnegative(),
  modifiedAt: z.number(),
}).strict();

export const probeSchema = z.object({
  duration: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.number().int().positive(),
}).strict();

export const hostContract = defineRpcContract({
  inspect: {
    input: z.object({ root: z.string().min(1) }).strict(),
    output: z.object({ videos: z.array(videoSchema) }).strict(),
  },
  probe: {
    input: z.object({ root: z.string().min(1), path: z.string().min(1) }).strict(),
    output: probeSchema,
  },
  exportMedia: {
    input: z.object({
      root: z.string().min(1),
      path: z.string().min(1),
      edit: editSchema,
      kind: z.enum(["video", "still"]),
      frame: z.number().int().min(0).nullable(),
    }).strict(),
    output: z.object({ path: z.string() }).strict(),
  },
});
