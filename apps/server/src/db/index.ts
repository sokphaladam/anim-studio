import type { SceneSpec } from "@anim/spec";
import Database from "better-sqlite3";
import { desc, eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { projects, versions } from "./schema";

// shortcut: tables are created here instead of drizzle-kit migrations; add drizzle-kit when the schema first changes
const DDL = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, duration REAL NOT NULL, chat TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, spec TEXT NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS versions_project ON versions(project_id, id);
`;

export type Store = ReturnType<typeof createStore>;

/** Projects and their spec versions in SQLite. Every save is a new version row, so undo can always step back. */
export function createStore(file: string) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  const db = drizzle(sqlite);

  const latest = (id: string) => db.select().from(versions).where(eq(versions.projectId, id)).orderBy(desc(versions.id)).limit(1).get();
  const touch = (id: string, spec: SceneSpec, chat?: unknown[]) =>
    db.update(projects).set({ title: spec.meta.title, duration: spec.meta.duration, updatedAt: Date.now(), ...(chat ? { chat } : {}) }).where(eq(projects.id, id)).run();

  return {
    /** Newest first, each with its latest spec (for thumbnails). */
    list() {
      const last = db.select({ pid: versions.projectId, vid: max(versions.id).as("vid") }).from(versions).groupBy(versions.projectId).as("last");
      return db
        .select({ id: projects.id, title: projects.title, duration: projects.duration, updatedAt: projects.updatedAt, spec: versions.spec })
        .from(projects)
        .innerJoin(last, eq(last.pid, projects.id))
        .innerJoin(versions, eq(versions.id, last.vid))
        .orderBy(desc(projects.updatedAt))
        .all();
    },
    get(id: string) {
      const p = db.select().from(projects).where(eq(projects.id, id)).get();
      const v = p && latest(id);
      return p && v ? { id, spec: v.spec, version: v.id, chat: p.chat } : null;
    },
    create(spec: SceneSpec, label: string, chat: unknown[] = []) {
      const id = randomUUID(), now = Date.now();
      return sqlite.transaction(() => {
        db.insert(projects).values({ id, title: spec.meta.title, duration: spec.meta.duration, chat, createdAt: now, updatedAt: now }).run();
        const v = db.insert(versions).values({ projectId: id, spec, label, createdAt: now }).returning({ id: versions.id }).get();
        return { id, version: v.id };
      })();
    },
    /** Adds a version (skipped when the spec is unchanged). Null if the project doesn't exist. */
    save(id: string, spec: SceneSpec, label: string, chat?: unknown[]) {
      return sqlite.transaction(() => {
        const v = latest(id);
        if (!v) return null;
        touch(id, spec, chat);
        if (JSON.stringify(v.spec) === JSON.stringify(spec)) return v.id;
        return db.insert(versions).values({ projectId: id, spec, label, createdAt: Date.now() }).returning({ id: versions.id }).get().id;
      })();
    },
    /** Drops the latest version and returns the one before it. Null if there is nothing to go back to. */
    undo(id: string) {
      return sqlite.transaction(() => {
        const [cur, prev] = db.select().from(versions).where(eq(versions.projectId, id)).orderBy(desc(versions.id)).limit(2).all();
        if (!prev) return null;
        db.delete(versions).where(eq(versions.id, cur.id)).run();
        touch(id, prev.spec);
        return { spec: prev.spec, version: prev.id, undid: cur.label };
      })();
    },
    close: () => sqlite.close(),
  };
}
