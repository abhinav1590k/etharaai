require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { db, dbFile } = require("./src/database");

const app = express();
const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET || "dev-secret-change-before-deploying";

app.use(express.json({ limit: "1mb" }));

const idField = z.string().min(8).max(80);
const emailField = z.string().trim().email().max(140).transform((value) => value.toLowerCase());
const nameField = z.string().trim().min(2).max(80);
const statusField = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
const priorityField = z.enum(["LOW", "MEDIUM", "HIGH"]);
const dateField = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format.").nullable().optional()
);
const nullableIdField = z.preprocess(
  (value) => (value === "" ? null : value),
  idField.nullable().optional()
);

const signupSchema = z.object({
  name: nameField,
  email: emailField,
  password: z.string().min(6).max(128)
});

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(128)
});

const projectCreateSchema = z.object({
  name: z.string().trim().min(3).max(90),
  description: z.string().trim().max(500).optional().default(""),
  memberIds: z.array(idField).optional().default([])
});

const projectUpdateSchema = z.object({
  name: z.string().trim().min(3).max(90).optional(),
  description: z.string().trim().max(500).optional()
}).strict();

const memberSchema = z.object({
  userId: idField
});

const taskCreateSchema = z.object({
  projectId: idField,
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(800).optional().default(""),
  assigneeId: nullableIdField,
  status: statusField.optional().default("TODO"),
  priority: priorityField.optional().default("MEDIUM"),
  dueDate: dateField
});

const taskUpdateSchema = z.object({
  projectId: idField.optional(),
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(800).optional(),
  assigneeId: nullableIdField,
  status: statusField.optional(),
  priority: priorityField.optional(),
  dueDate: dateField
}).strict();

const roleUpdateSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"])
});

function parseBody(schema, body, res) {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({
      message: "Validation failed.",
      errors: result.error.flatten().fieldErrors
    });
    return null;
  }
  return result.data;
}

function makeId() {
  return crypto.randomUUID();
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at
  };
}

function mapProject(row) {
  const taskCount = Number(row.task_count || 0);
  const doneCount = Number(row.done_count || 0);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    createdAt: row.created_at,
    memberCount: Number(row.member_count || 0),
    taskCount,
    doneCount,
    overdueCount: Number(row.overdue_count || 0),
    progress: taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0
  };
}

function mapTask(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    title: row.title,
    description: row.description,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    assigneeEmail: row.assignee_email,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    createdBy: row.created_by,
    creatorName: row.creator_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function getProjectById(id) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
}

function getTaskById(id) {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
}

function isProjectMember(projectId, userId) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?")
      .get(projectId, userId)
  );
}

function canAccessProject(user, projectId) {
  return user.role === "ADMIN" || isProjectMember(projectId, user.id);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = getUserById(payload.sub);

    if (!user) {
      return res.status(401).json({ message: "User no longer exists." });
    }

    req.user = publicUser(user);
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Admin access required." });
  }
  return next();
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: "7d" });
}

function projectSummariesFor(user) {
  const memberWhere =
    user.role === "ADMIN"
      ? ""
      : "WHERE EXISTS (SELECT 1 FROM project_members access WHERE access.project_id = p.id AND access.user_id = ?)";
  const params = user.role === "ADMIN" ? [] : [user.id];

  return db
    .prepare(`
      SELECT
        p.*,
        owner.name AS owner_name,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'DONE') AS done_count,
        (
          SELECT COUNT(*)
          FROM tasks t
          WHERE t.project_id = p.id
            AND t.status != 'DONE'
            AND t.due_date IS NOT NULL
            AND date(t.due_date) < date('now')
        ) AS overdue_count
      FROM projects p
      LEFT JOIN users owner ON owner.id = p.owner_id
      ${memberWhere}
      ORDER BY datetime(p.created_at) DESC
    `)
    .all(params)
    .map(mapProject);
}

function projectMembers(projectId) {
  return db
    .prepare(`
      SELECT u.id, u.name, u.email, u.role, u.created_at, pm.joined_at
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY u.name COLLATE NOCASE
    `)
    .all(projectId)
    .map((row) => ({ ...publicUser(row), joinedAt: row.joined_at }));
}

function taskRowsFor(user, filters = {}) {
  const where = [];
  const params = [];

  if (user.role !== "ADMIN") {
    where.push(`
      EXISTS (
        SELECT 1
        FROM project_members access
        WHERE access.project_id = t.project_id
          AND access.user_id = ?
      )
    `);
    params.push(user.id);
  }

  if (filters.projectId) {
    where.push("t.project_id = ?");
    params.push(filters.projectId);
  }

  if (filters.status) {
    where.push("t.status = ?");
    params.push(filters.status);
  }

  if (filters.assigneeId) {
    where.push("t.assignee_id = ?");
    params.push(filters.assigneeId);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return db
    .prepare(`
      SELECT
        t.*,
        p.name AS project_name,
        assignee.name AS assignee_name,
        assignee.email AS assignee_email,
        creator.name AS creator_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users assignee ON assignee.id = t.assignee_id
      LEFT JOIN users creator ON creator.id = t.created_by
      ${whereSql}
      ORDER BY
        CASE WHEN t.status = 'DONE' THEN 1 ELSE 0 END,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        date(t.due_date) ASC,
        datetime(t.created_at) DESC
    `)
    .all(params);
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "team-task-manager",
    database: path.basename(dbFile)
  });
});

app.post("/api/auth/signup", async (req, res, next) => {
  try {
    const payload = parseBody(signupSchema, req.body, res);
    if (!payload) return;

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(payload.email);
    if (existing) {
      return res.status(409).json({ message: "Email is already registered." });
    }

    const usersCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
    const user = {
      id: makeId(),
      name: payload.name,
      email: payload.email,
      passwordHash: await bcrypt.hash(payload.password, 10),
      role: usersCount === 0 ? "ADMIN" : "MEMBER"
    };

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, user.name, user.email, user.passwordHash, user.role);

    const stored = getUserById(user.id);
    res.status(201).json({ user: publicUser(stored), token: signToken(stored) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const payload = parseBody(loginSchema, req.body, res);
    if (!payload) return;

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(payload.email);
    const matches = user ? await bcrypt.compare(payload.password, user.password_hash) : false;

    if (!matches) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    res.json({ user: publicUser(user), token: signToken(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/users", requireAuth, (req, res) => {
  if (req.user.role === "ADMIN") {
    const users = db
      .prepare("SELECT id, name, email, role, created_at FROM users ORDER BY name COLLATE NOCASE")
      .all()
      .map(publicUser);
    return res.json({ users });
  }

  const users = db
    .prepare(`
      SELECT DISTINCT u.id, u.name, u.email, u.role, u.created_at
      FROM users u
      WHERE u.id = ?
         OR u.id IN (
           SELECT teammate.user_id
           FROM project_members mine
           JOIN project_members teammate ON teammate.project_id = mine.project_id
           WHERE mine.user_id = ?
         )
      ORDER BY u.name COLLATE NOCASE
    `)
    .all(req.user.id, req.user.id)
    .map(publicUser);

  return res.json({ users });
});

app.patch("/api/users/:id/role", requireAuth, requireAdmin, (req, res) => {
  const payload = parseBody(roleUpdateSchema, req.body, res);
  if (!payload) return;

  const target = getUserById(req.params.id);
  if (!target) {
    return res.status(404).json({ message: "User not found." });
  }

  if (target.role === "ADMIN" && payload.role === "MEMBER") {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ message: "At least one admin must remain." });
    }
  }

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(payload.role, req.params.id);
  return res.json({ user: publicUser(getUserById(req.params.id)) });
});

app.get("/api/projects", requireAuth, (req, res) => {
  res.json({ projects: projectSummariesFor(req.user) });
});

app.post("/api/projects", requireAuth, requireAdmin, (req, res) => {
  const payload = parseBody(projectCreateSchema, req.body, res);
  if (!payload) return;

  const uniqueMemberIds = [...new Set([req.user.id, ...payload.memberIds])];
  const missingUserId = uniqueMemberIds.find((userId) => !getUserById(userId));
  if (missingUserId) {
    return res.status(400).json({ message: "One or more team members do not exist." });
  }

  const createProject = db.transaction(() => {
    const projectId = makeId();
    db.prepare(`
      INSERT INTO projects (id, name, description, owner_id)
      VALUES (?, ?, ?, ?)
    `).run(projectId, payload.name, payload.description, req.user.id);

    const insertMember = db.prepare(`
      INSERT OR IGNORE INTO project_members (project_id, user_id)
      VALUES (?, ?)
    `);
    uniqueMemberIds.forEach((userId) => insertMember.run(projectId, userId));

    return projectId;
  });

  const projectId = createProject();
  return res.status(201).json({
    project: projectSummariesFor(req.user).find((project) => project.id === projectId),
    members: projectMembers(projectId)
  });
});

app.get("/api/projects/:id", requireAuth, (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project || !canAccessProject(req.user, req.params.id)) {
    return res.status(404).json({ message: "Project not found." });
  }

  return res.json({
    project: projectSummariesFor(req.user).find((item) => item.id === req.params.id),
    members: projectMembers(req.params.id)
  });
});

app.patch("/api/projects/:id", requireAuth, requireAdmin, (req, res) => {
  const payload = parseBody(projectUpdateSchema, req.body, res);
  if (!payload) return;

  const project = getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ message: "Project not found." });
  }

  const changes = [];
  const values = [];
  if (payload.name !== undefined) {
    changes.push("name = ?");
    values.push(payload.name);
  }
  if (payload.description !== undefined) {
    changes.push("description = ?");
    values.push(payload.description);
  }

  if (changes.length) {
    db.prepare(`UPDATE projects SET ${changes.join(", ")} WHERE id = ?`).run(...values, req.params.id);
  }

  return res.json({
    project: projectSummariesFor(req.user).find((item) => item.id === req.params.id),
    members: projectMembers(req.params.id)
  });
});

app.delete("/api/projects/:id", requireAuth, requireAdmin, (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ message: "Project not found." });
  }

  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  return res.status(204).end();
});

app.post("/api/projects/:id/members", requireAuth, requireAdmin, (req, res) => {
  const payload = parseBody(memberSchema, req.body, res);
  if (!payload) return;

  if (!getProjectById(req.params.id)) {
    return res.status(404).json({ message: "Project not found." });
  }

  if (!getUserById(payload.userId)) {
    return res.status(400).json({ message: "User not found." });
  }

  db.prepare(`
    INSERT OR IGNORE INTO project_members (project_id, user_id)
    VALUES (?, ?)
  `).run(req.params.id, payload.userId);

  return res.status(201).json({ members: projectMembers(req.params.id) });
});

app.delete("/api/projects/:id/members/:userId", requireAuth, requireAdmin, (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ message: "Project not found." });
  }

  if (project.owner_id === req.params.userId) {
    return res.status(400).json({ message: "Project owner cannot be removed from the team." });
  }

  db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(
    req.params.id,
    req.params.userId
  );

  return res.status(204).end();
});

app.get("/api/tasks", requireAuth, (req, res) => {
  const filters = {
    projectId: req.query.projectId,
    status: req.query.status,
    assigneeId: req.query.assigneeId
  };

  if (filters.status && !["TODO", "IN_PROGRESS", "DONE"].includes(filters.status)) {
    return res.status(400).json({ message: "Invalid status filter." });
  }

  if (filters.projectId && !canAccessProject(req.user, filters.projectId)) {
    return res.status(403).json({ message: "You cannot access this project." });
  }

  return res.json({ tasks: taskRowsFor(req.user, filters).map(mapTask) });
});

app.post("/api/tasks", requireAuth, requireAdmin, (req, res) => {
  const payload = parseBody(taskCreateSchema, req.body, res);
  if (!payload) return;

  if (!getProjectById(payload.projectId)) {
    return res.status(400).json({ message: "Project not found." });
  }

  if (payload.assigneeId && !isProjectMember(payload.projectId, payload.assigneeId)) {
    return res.status(400).json({ message: "Assignee must be a member of the selected project." });
  }

  const taskId = makeId();
  db.prepare(`
    INSERT INTO tasks (
      id, project_id, title, description, assignee_id,
      status, priority, due_date, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    payload.projectId,
    payload.title,
    payload.description,
    payload.assigneeId || null,
    payload.status,
    payload.priority,
    payload.dueDate || null,
    req.user.id
  );

  const task = taskRowsFor(req.user, {}).find((item) => item.id === taskId);
  return res.status(201).json({ task: mapTask(task) });
});

app.get("/api/tasks/:id", requireAuth, (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task || !canAccessProject(req.user, task.project_id)) {
    return res.status(404).json({ message: "Task not found." });
  }

  const row = taskRowsFor(req.user, {}).find((item) => item.id === req.params.id);
  return res.json({ task: mapTask(row) });
});

app.patch("/api/tasks/:id", requireAuth, (req, res) => {
  const payload = parseBody(taskUpdateSchema, req.body, res);
  if (!payload) return;

  const task = getTaskById(req.params.id);
  if (!task || !canAccessProject(req.user, task.project_id)) {
    return res.status(404).json({ message: "Task not found." });
  }

  if (req.user.role !== "ADMIN") {
    const keys = Object.keys(payload);
    if (task.assignee_id !== req.user.id || keys.length !== 1 || keys[0] !== "status") {
      return res.status(403).json({
        message: "Members can only update the status of tasks assigned to them."
      });
    }
  }

  const nextProjectId = payload.projectId || task.project_id;
  const nextAssigneeId = payload.assigneeId !== undefined ? payload.assigneeId : task.assignee_id;

  if (!getProjectById(nextProjectId)) {
    return res.status(400).json({ message: "Project not found." });
  }

  if (nextAssigneeId && !isProjectMember(nextProjectId, nextAssigneeId)) {
    return res.status(400).json({ message: "Assignee must be a member of the selected project." });
  }

  const changes = [];
  const values = [];
  const addChange = (column, value) => {
    changes.push(`${column} = ?`);
    values.push(value);
  };

  if (payload.projectId !== undefined) addChange("project_id", payload.projectId);
  if (payload.title !== undefined) addChange("title", payload.title);
  if (payload.description !== undefined) addChange("description", payload.description);
  if (payload.assigneeId !== undefined) addChange("assignee_id", payload.assigneeId || null);
  if (payload.status !== undefined) addChange("status", payload.status);
  if (payload.priority !== undefined) addChange("priority", payload.priority);
  if (payload.dueDate !== undefined) addChange("due_date", payload.dueDate || null);

  if (changes.length) {
    changes.push("updated_at = datetime('now')");
    db.prepare(`UPDATE tasks SET ${changes.join(", ")} WHERE id = ?`).run(...values, req.params.id);
  }

  const row = taskRowsFor(req.user, {}).find((item) => item.id === req.params.id);
  return res.json({ task: mapTask(row) });
});

app.delete("/api/tasks/:id", requireAuth, requireAdmin, (req, res) => {
  const task = getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ message: "Task not found." });
  }

  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  return res.status(204).end();
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const tasks = taskRowsFor(req.user, {}).map(mapTask);
  const projects = projectSummariesFor(req.user);
  const today = new Date().toISOString().slice(0, 10);

  const status = {
    TODO: 0,
    IN_PROGRESS: 0,
    DONE: 0
  };

  tasks.forEach((task) => {
    status[task.status] += 1;
  });

  const overdueTasks = tasks.filter(
    (task) => task.dueDate && task.dueDate < today && task.status !== "DONE"
  );
  const myTasks = tasks.filter((task) => task.assigneeId === req.user.id);
  const dueSoon = tasks
    .filter((task) => task.dueDate && task.status !== "DONE")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  res.json({
    stats: {
      projects: projects.length,
      totalTasks: tasks.length,
      todo: status.TODO,
      inProgress: status.IN_PROGRESS,
      done: status.DONE,
      overdue: overdueTasks.length,
      myTasks: myTasks.length,
      completion:
        tasks.length > 0 ? Math.round((status.DONE / tasks.length) * 100) : 0
    },
    status,
    dueSoon,
    overdueTasks: overdueTasks.slice(0, 6),
    projects
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.use("/api", (req, res) => {
  res.status(404).json({ message: "API route not found." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);

  if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ message: "A record with this value already exists." });
  }

  return res.status(500).json({ message: "Something went wrong on the server." });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Team Task Manager running on http://localhost:${port}`);
    console.log(`Database: ${dbFile}`);
  });
}

module.exports = app;
