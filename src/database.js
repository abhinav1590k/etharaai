const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const rootDir = path.resolve(__dirname, "..");

function resolveDatabaseFile() {
  if (process.env.DB_FILE) {
    return path.isAbsolute(process.env.DB_FILE)
      ? process.env.DB_FILE
      : path.resolve(rootDir, process.env.DB_FILE);
  }

  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "team-task-manager.sqlite");
  }

  return path.join(rootDir, "data", "team-task-manager.sqlite");
}

const dbFile = resolveDatabaseFile();
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')) DEFAULT 'MEMBER',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')) DEFAULT 'TODO',
      priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')) DEFAULT 'MEDIUM',
      due_date TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
  `);
}

ensureSchema();

module.exports = {
  db,
  dbFile,
  ensureSchema
};
