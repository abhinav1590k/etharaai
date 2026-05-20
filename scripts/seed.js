const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { db, dbFile } = require("../src/database");

function id() {
  return crypto.randomUUID();
}

function ensureUser({ name, email, password, role }) {
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (existing) return existing;

  const userId = id();
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, name, email, bcrypt.hashSync(password, 10), role);

  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function ensureProject({ name, description, ownerId, memberIds }) {
  const existing = db.prepare("SELECT * FROM projects WHERE name = ?").get(name);
  const projectId = existing?.id || id();

  if (!existing) {
    db.prepare(`
      INSERT INTO projects (id, name, description, owner_id)
      VALUES (?, ?, ?, ?)
    `).run(projectId, name, description, ownerId);
  }

  const addMember = db.prepare(`
    INSERT OR IGNORE INTO project_members (project_id, user_id)
    VALUES (?, ?)
  `);
  [ownerId, ...memberIds].forEach((userId) => addMember.run(projectId, userId));

  return db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
}

function ensureTask({ projectId, title, description, assigneeId, priority, status, dueDate, createdBy }) {
  const existing = db
    .prepare("SELECT * FROM tasks WHERE project_id = ? AND title = ?")
    .get(projectId, title);
  if (existing) return existing;

  const taskId = id();
  db.prepare(`
    INSERT INTO tasks (
      id, project_id, title, description, assignee_id,
      status, priority, due_date, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    projectId,
    title,
    description,
    assigneeId,
    status,
    priority,
    dueDate,
    createdBy
  );

  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}

const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);
const nextWeek = new Date(today);
nextWeek.setDate(today.getDate() + 7);
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);

const admin = ensureUser({
  name: "Avery Admin",
  email: "admin@example.com",
  password: "admin123",
  role: "ADMIN"
});

const member = ensureUser({
  name: "Mira Member",
  email: "member@example.com",
  password: "member123",
  role: "MEMBER"
});

const designer = ensureUser({
  name: "Dev Patel",
  email: "dev@example.com",
  password: "member123",
  role: "MEMBER"
});

const project = ensureProject({
  name: "Website Launch",
  description: "Coordinate release tasks for the marketing site and handoff checklist.",
  ownerId: admin.id,
  memberIds: [member.id, designer.id]
});

ensureTask({
  projectId: project.id,
  title: "Finalize dashboard copy",
  description: "Review headings and empty states before launch.",
  assigneeId: member.id,
  priority: "HIGH",
  status: "IN_PROGRESS",
  dueDate: tomorrow.toISOString().slice(0, 10),
  createdBy: admin.id
});

ensureTask({
  projectId: project.id,
  title: "QA role permissions",
  description: "Confirm members cannot delete projects or assign tasks.",
  assigneeId: designer.id,
  priority: "MEDIUM",
  status: "TODO",
  dueDate: nextWeek.toISOString().slice(0, 10),
  createdBy: admin.id
});

ensureTask({
  projectId: project.id,
  title: "Archive old assets",
  description: "Move unused launch files into the archive folder.",
  assigneeId: member.id,
  priority: "LOW",
  status: "TODO",
  dueDate: yesterday.toISOString().slice(0, 10),
  createdBy: admin.id
});

console.log(`Seeded database: ${dbFile}`);
console.log("Demo admin: admin@example.com / admin123");
console.log("Demo member: member@example.com / member123");
