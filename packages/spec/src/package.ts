import { z } from "zod";

/**
 * The Anim Studio → CR Content package contract: what a delivered animation is. A package is a ZIP holding a silent
 * looping MP4 (the dependable playback file), this manifest, the portable scene (for later revisions), every image it
 * uses, and the loop report. Every path is relative and inside the package; every file has a checksum.
 */
export const PACKAGE_SCHEMA = "anim-studio.package";
export const PACKAGE_VERSION = 1;

/** A path inside the package: relative, forward slashes, no "..", nothing hidden or absolute. */
export const PackagePath = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (p) => /^[A-Za-z0-9._/-]+$/.test(p) && !p.startsWith("/") && p.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "Expected a relative path inside the package (letters, digits, . _ - /; no .., no absolute paths)",
  );

export const PackageFileSchema = z.object({ path: PackagePath, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(0) });

export const PackageManifestSchema = z.object({
  schema: z.literal(PACKAGE_SCHEMA),
  version: z.number().int().positive(),
  title: z.string(),
  /** The project it was exported from, when it was saved. */
  sceneId: z.string().optional(),
  exportedAt: z.string().datetime(),
  video: z.object({
    file: PackagePath,
    codec: z.literal("h264"),
    pixelFormat: z.literal("yuv420p"),
    colorSpace: z.literal("bt709"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    frames: z.number().int().positive(),
    /** Seconds: frames / fps. CR Content loops on this, not on a fixed length. */
    duration: z.number().positive(),
    /** Always false: the song's audio is added once, by CR Content. */
    audio: z.literal(false),
    /** The scene is meant to loop; `loopValidated` says whether the loop check passed. */
    loop: z.literal(true),
    loopValidated: z.boolean(),
  }),
  scene: PackagePath,
  report: PackagePath,
  files: z.array(PackageFileSchema).min(1),
});
export type PackageManifest = z.output<typeof PackageManifestSchema>;
