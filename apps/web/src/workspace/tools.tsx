import { Brush, Eraser, PaintBucket, Shapes, Move, SquareDashed, Pipette, type LucideIcon } from "lucide-react";
import type { Tool } from "../store";

export const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon }[] = [
  { id: "brush", label: "Brush", key: "B", icon: Brush },
  { id: "eraser", label: "Eraser", key: "E", icon: Eraser },
  { id: "fill", label: "Fill", key: "F", icon: PaintBucket },
  { id: "shapes", label: "Shapes", key: "U", icon: Shapes },
  { id: "transform", label: "Move / Transform", key: "T", icon: Move },
  { id: "select", label: "Select", key: "S", icon: SquareDashed },
  { id: "eyedropper", label: "Eyedropper", key: "P", icon: Pipette },
];
