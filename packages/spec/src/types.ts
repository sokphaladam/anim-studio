import type { z } from "zod";
import type { SceneSpecSchema as S, LayerSchema as L, OverlaySchema as O, TrackSchema as T, BeatSchema as B, EaseSchema as E, DrawingFrameSchema as DF, StrokeSchema as ST, AssetSchema as AS, ActionSchema as AC, AssetCheckSchema as ACK, CleanupSchema as CL, CharacterProfileSchema as CP, MeshSchema as MS, IKSchema as IKS, SwitchSchema as SW, KeyEaseSchema as KE } from "./schema";

/** A validated scene with defaults applied. */
export type SceneSpec = z.output<typeof S>;
/** What a scene looks like on disk / from the AI, before defaults. */
export type SceneSpecInput = z.input<typeof S>;
export type Layer = z.output<typeof L>;
export type Overlay = z.output<typeof O>;
export type Track = z.output<typeof T>;
export type Beat = z.output<typeof B>;
export type Ease = z.output<typeof E>;
export type DrawingFrame = z.output<typeof DF>;
export type Stroke = z.output<typeof ST>;
export type Asset = z.output<typeof AS>;
export type Action = z.output<typeof AC>;
export type AssetCheck = z.output<typeof ACK>;
export type Cleanup = z.output<typeof CL>;
export type CharacterProfile = z.output<typeof CP>;
export type Mesh = z.output<typeof MS>;
export type IK = z.output<typeof IKS>;
export type Switch = z.output<typeof SW>;
export type KeyEase = z.output<typeof KE>;

/** Param type after "@track" / "$palette" references are resolved to plain values. */
export type Resolved<T> = T extends `@${string}`
  ? number
  : T extends string | number | boolean | null | undefined
    ? T
    : { [K in keyof T]: Resolved<T[K]> };
