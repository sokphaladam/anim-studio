import type { SceneSpec } from "@anim/spec";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  duration: real("duration").notNull(),
  chat: text("chat", { mode: "json" }).$type<unknown[]>().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const versions = sqliteTable("versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  spec: text("spec", { mode: "json" }).$type<SceneSpec>().notNull(),
  label: text("label").notNull(),
  createdAt: integer("created_at").notNull(),
});
