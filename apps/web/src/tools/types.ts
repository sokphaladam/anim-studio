import type { SceneSpec } from "@anim/spec";

export type Pt = [number, number];
export type Ctx2D = CanvasRenderingContext2D;

/** What a tool can ask of the canvas: coordinate mapping, the target layer and feedback. */
export interface ToolContext {
  spec: SceneSpec;
  /** Current frame number and its time in seconds. */
  frame: number;
  time: number;
  /** Pointer position in scene units. */
  scene: Pt;
  /** Scene position of any pointer event (e.g. coalesced pen samples). */
  sceneAt(e: PointerEvent): Pt;
  /** Scene → a layer's own coordinates, and back. */
  toLayer(layerId: string, p: Pt): Pt;
  fromLayer(layerId: string, p: Pt): Pt;
  /** Scene units per screen pixel (for hit-test sizes and handle sizes). */
  unitsPerPx: number;
  /** The selected drawing layer, creating one if needed; null (with a message shown) if it is locked. */
  drawingTarget(): string | null;
  /** Color of the rendered canvas under the pointer. */
  pickColor(): string | null;
  toast(title: string, description?: string): void;
}

export interface ToolController {
  down(e: PointerEvent, c: ToolContext): void;
  move(e: PointerEvent, c: ToolContext): void;
  up(e: PointerEvent, c: ToolContext): void;
  /** Draws previews/handles on the overlay, in scene units. `hover` is the pointer when not dragging. */
  overlay(g: Ctx2D, c: Omit<ToolContext, "scene"> & { scene: Pt | null }): void;
  cursor?: string;
}
