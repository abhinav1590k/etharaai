const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const tokenKey = "team_task_manager_token";
const statusLabels = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done"
};
const priorityLabels = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High"
};

const state = {
  token: localStorage.getItem(tokenKey),
  user: null,
  users: [],
  projects: [],
  tasks: [],
  dashboard: null,
  selectedProjectId: "all",
  selectedProjectDetail: null,
  authMode: "login",
  statusFilter: "all"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function initials(name) {
  return String(name || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function isAdmin() {
  return state.user?.role === "ADMIN";
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

async function bootstrap() {
  if (!state.token) {
    renderAuth();
    return;
  }

  try {
    const { user } = await api("/auth/me");
    state.user = user;
    await loadData();
  } catch (error) {
    localStorage.removeItem(tokenKey);
    state.token = null;
    state.user = null;
    renderAuth();
  }
}

async function loadData() {
  const [usersResponse, projectsResponse, dashboardResponse] = await Promise.all([
    api("/users"),
    api("/projects"),
    api("/dashboard")
  ]);

  state.users = usersResponse.users;
  state.projects = projectsResponse.projects;
  state.dashboard = dashboardResponse;

  if (
    state.selectedProjectId !== "all" &&
    !state.projects.some((project) => project.id === state.selectedProjectId)
  ) {
    state.selectedProjectId = "all";
  }

  const projectQuery =
    state.selectedProjectId === "all"
      ? ""
      : `?projectId=${encodeURIComponent(state.selectedProjectId)}`;
  const detailRequest =
    state.selectedProjectId === "all"
      ? Promise.resolve(null)
      : api(`/projects/${state.selectedProjectId}`);

  const [tasksResponse, detailResponse] = await Promise.all([
    api(`/tasks${projectQuery}`),
    detailRequest
  ]);

  state.tasks = tasksResponse.tasks;
  state.selectedProjectDetail = detailResponse;
  renderApp();
}

function renderAuth() {
  const isSignup = state.authMode === "signup";

  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-intro">
        <div class="brand-block">
          <div class="brand-mark">TT</div>
          <h1>Team Task Manager</h1>
          <p>Project planning, team assignment, due-date tracking, and role-aware execution in one focused workspace.</p>
        </div>
        <div class="auth-metrics" aria-label="Application highlights">
          <div class="auth-metric"><strong>RBAC</strong><span>Admin and member roles</span></div>
          <div class="auth-metric"><strong>SQL</strong><span>Relational project data</span></div>
          <div class="auth-metric"><strong>REST</strong><span>Clean API endpoints</span></div>
        </div>
      </section>
      <section class="auth-panel-wrap">
        <div class="auth-panel">
          <h2>${isSignup ? "Create account" : "Welcome back"}</h2>
          <p class="muted">${isSignup ? "The first account becomes the admin." : "Sign in to open your workspace."}</p>
          <div class="segmented">
            <button type="button" data-action="auth-mode" data-mode="login" class="${state.authMode === "login" ? "active" : ""}">Login</button>
            <button type="button" data-action="auth-mode" data-mode="signup" class="${state.authMode === "signup" ? "active" : ""}">Signup</button>
          </div>
          <form class="form" id="auth-form">
            <div class="field ${isSignup ? "" : "hide"}">
              <label for="name">Name</label>
              <input id="name" name="name" autocomplete="name" minlength="2" ${isSignup ? "required" : ""}>
            </div>
            <div class="field">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" autocomplete="email" required>
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" minlength="6" required>
            </div>
            <button class="button primary" type="submit">${isSignup ? "Create account" : "Login"}</button>
          </form>
        </div>
      </section>
    </main>
  `;
}

function renderApp() {
  const dashboard = state.dashboard?.stats || {
    projects: 0,
    totalTasks: 0,
    inProgress: 0,
    overdue: 0,
    completion: 0
  };

  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div class="topbar-left">
          <div class="avatar">${escapeHtml(initials(state.user.name))}</div>
          <div class="topbar-title">
            <strong>Team Task Manager</strong>
            <span>${escapeHtml(state.user.name)} - ${escapeHtml(state.user.email)}</span>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="pill ${state.user.role === "ADMIN" ? "admin" : "member"}">${escapeHtml(state.user.role)}</span>
          <button class="button secondary" type="button" data-action="reload">Refresh</button>
          <button class="button secondary" type="button" data-action="logout">Logout</button>
        </div>
      </header>
      <div class="layout">
        <aside class="sidebar">
          ${renderSidebar()}
        </aside>
        <section class="workspace">
          ${renderStats(dashboard)}
          <div class="split">
            ${renderProjectPanel()}
            ${isAdmin() ? renderAdminPanel() : renderMemberPanel()}
          </div>
          ${renderTaskSection()}
        </section>
      </div>
    </main>
  `;
}

function renderSidebar() {
  return `
    <div class="section-head">
      <h3>Projects</h3>
      <span class="pill">${state.projects.length}</span>
    </div>
    <div class="project-list">
      <button class="project-button ${state.selectedProjectId === "all" ? "active" : ""}" type="button" data-action="select-project" data-id="all">
        <div class="project-row">
          <strong>All projects</strong>
          <span class="pill">${state.dashboard?.stats?.totalTasks || 0} tasks</span>
        </div>
        <div class="progress"><span style="width:${state.dashboard?.stats?.completion || 0}%"></span></div>
      </button>
      ${state.projects.map(renderProjectButton).join("") || `<div class="empty">No projects yet.</div>`}
    </div>
  `;
}

function renderProjectButton(project) {
  return `
    <button class="project-button ${state.selectedProjectId === project.id ? "active" : ""}" type="button" data-action="select-project" data-id="${escapeHtml(project.id)}">
      <div class="project-row">
        <strong>${escapeHtml(project.name)}</strong>
        <span class="pill">${project.progress}%</span>
      </div>
      <p class="muted">${project.taskCount} tasks - ${project.memberCount} members</p>
      <div class="progress"><span style="width:${project.progress}%"></span></div>
    </button>
  `;
}

function renderStats(stats) {
  return `
    <div class="stat-grid">
      <div class="stat-card green"><span>Projects</span><strong>${stats.projects}</strong><small>Active team spaces</small></div>
      <div class="stat-card blue"><span>Total tasks</span><strong>${stats.totalTasks}</strong><small>${stats.inProgress} in progress</small></div>
      <div class="stat-card amber"><span>Completion</span><strong>${stats.completion}%</strong><small>${stats.done || 0} finished</small></div>
      <div class="stat-card red"><span>Overdue</span><strong>${stats.overdue}</strong><small>Open past due date</small></div>
    </div>
  `;
}

function renderProjectPanel() {
  if (state.selectedProjectId === "all") {
    return `
      <section class="panel">
        <div class="section-head">
          <div>
            <h2>Dashboard</h2>
            <p class="muted">Portfolio progress across every accessible project.</p>
          </div>
        </div>
        ${renderDueList("Due soon", state.dashboard?.dueSoon || [])}
      </section>
    `;
  }

  const project = state.selectedProjectDetail?.project;
  const members = state.selectedProjectDetail?.members || [];

  if (!project) {
    return `<section class="panel"><div class="empty">Select a project to view details.</div></section>`;
  }

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h2>${escapeHtml(project.name)}</h2>
          <p class="muted">${escapeHtml(project.description || "No description")}</p>
        </div>
        ${isAdmin() ? `<button class="button danger" type="button" data-action="delete-project" data-id="${escapeHtml(project.id)}">Delete</button>` : ""}
      </div>
      <div class="stat-grid">
        <div class="stat-card green"><span>Progress</span><strong>${project.progress}%</strong><small>${project.doneCount} of ${project.taskCount} done</small></div>
        <div class="stat-card blue"><span>Members</span><strong>${project.memberCount}</strong><small>Assigned team</small></div>
        <div class="stat-card red"><span>Overdue</span><strong>${project.overdueCount}</strong><small>Needs attention</small></div>
        <div class="stat-card amber"><span>Owner</span><strong>${escapeHtml(initials(project.ownerName))}</strong><small>${escapeHtml(project.ownerName || "Admin")}</small></div>
      </div>
      <div class="section-head">
        <h3>Team</h3>
      </div>
      <div class="member-list">
        ${members.map(renderMemberChip).join("") || `<span class="muted">No members.</span>`}
      </div>
      ${isAdmin() ? renderMemberForm(members) : ""}
    </section>
  `;
}

function renderMemberChip(member) {
  const canRemove =
    isAdmin() &&
    state.selectedProjectDetail?.project?.ownerId !== member.id &&
    member.id !== state.user.id;

  return `
    <span class="member-chip">
      <span>${escapeHtml(member.name)}</span>
      <small class="pill ${member.role === "ADMIN" ? "admin" : "member"}">${escapeHtml(member.role)}</small>
      ${canRemove ? `<button type="button" title="Remove member" data-action="remove-member" data-user-id="${escapeHtml(member.id)}">x</button>` : ""}
    </span>
  `;
}

function renderMemberForm(members) {
  const memberIds = new Set(members.map((member) => member.id));
  const choices = state.users.filter((user) => !memberIds.has(user.id));

  if (!choices.length) return "";

  return `
    <form class="inline-form" id="member-form">
      <div class="field">
        <label for="member-user">Add member</label>
        <select id="member-user" name="userId" required>
          <option value="">Select user</option>
          ${choices.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} - ${escapeHtml(user.role)}</option>`).join("")}
        </select>
      </div>
      <button class="button secondary" type="submit">Add to team</button>
    </form>
  `;
}

function renderAdminPanel() {
  return `
    <section class="panel">
      <div class="section-head">
        <h3>Admin controls</h3>
      </div>
      <form class="form" id="project-form">
        <div class="field">
          <label for="project-name">Project name</label>
          <input id="project-name" name="name" minlength="3" maxlength="90" required>
        </div>
        <div class="field">
          <label for="project-description">Description</label>
          <textarea id="project-description" name="description" maxlength="500"></textarea>
        </div>
        <div class="field">
          <label for="project-members">Initial members</label>
          <select id="project-members" name="memberIds" multiple size="4">
            ${state.users
              .filter((user) => user.id !== state.user.id)
              .map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} - ${escapeHtml(user.role)}</option>`)
              .join("")}
          </select>
        </div>
        <button class="button primary" type="submit">Create project</button>
      </form>
      <hr>
      ${renderTaskForm()}
    </section>
  `;
}

function renderTaskForm() {
  if (!state.projects.length) {
    return `<div class="empty">Create a project before adding tasks.</div>`;
  }

  const selectedProject = state.selectedProjectId === "all" ? state.projects[0]?.id : state.selectedProjectId;

  return `
    <form class="form" id="task-form">
      <div class="section-head">
        <h3>New task</h3>
      </div>
      <div class="form-grid">
        <div class="field wide">
          <label for="task-title">Title</label>
          <input id="task-title" name="title" minlength="3" maxlength="120" required>
        </div>
        <div class="field">
          <label for="task-project">Project</label>
          <select id="task-project" name="projectId" required>
            ${state.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === selectedProject ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="task-assignee">Assignee</label>
          <select id="task-assignee" name="assigneeId">
            <option value="">Unassigned</option>
            ${state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="task-priority">Priority</label>
          <select id="task-priority" name="priority">
            <option value="LOW">Low</option>
            <option value="MEDIUM" selected>Medium</option>
            <option value="HIGH">High</option>
          </select>
        </div>
        <div class="field">
          <label for="task-due">Due date</label>
          <input id="task-due" name="dueDate" type="date">
        </div>
        <div class="field wide">
          <label for="task-description">Description</label>
          <textarea id="task-description" name="description" maxlength="800"></textarea>
        </div>
      </div>
      <button class="button primary" type="submit">Create task</button>
    </form>
  `;
}

function renderMemberPanel() {
  const myTasks = state.tasks.filter((task) => task.assigneeId === state.user.id);
  return `
    <section class="panel">
      <div class="section-head">
        <h3>My queue</h3>
        <span class="pill">${myTasks.length} assigned</span>
      </div>
      ${renderDueList("Assigned due soon", myTasks.filter((task) => task.dueDate && task.status !== "DONE").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5))}
    </section>
  `;
}

function renderDueList(title, tasks) {
  return `
    <div class="section-head">
      <h3>${escapeHtml(title)}</h3>
    </div>
    <div class="task-grid">
      ${tasks
        .map(
          (task) => `
            <article class="task-card ${isOverdue(task) ? "overdue" : ""}">
              <div class="task-top">
                <div class="task-title">
                  <strong>${escapeHtml(task.title)}</strong>
                  <span class="muted">${escapeHtml(task.projectName)}${task.dueDate ? ` - Due ${escapeHtml(task.dueDate)}` : ""}</span>
                </div>
                ${renderStatusPill(task.status)}
              </div>
            </article>
          `
        )
        .join("") || `<div class="empty">Nothing due right now.</div>`}
    </div>
  `;
}

function renderTaskSection() {
  const visibleTasks =
    state.statusFilter === "all"
      ? state.tasks
      : state.tasks.filter((task) => task.status === state.statusFilter);

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h2>Tasks</h2>
          <p class="muted">${state.selectedProjectId === "all" ? "All accessible work" : "Selected project work"}</p>
        </div>
      </div>
      <div class="toolbar">
        <select id="status-filter" aria-label="Filter by status">
          <option value="all" ${state.statusFilter === "all" ? "selected" : ""}>All statuses</option>
          <option value="TODO" ${state.statusFilter === "TODO" ? "selected" : ""}>To do</option>
          <option value="IN_PROGRESS" ${state.statusFilter === "IN_PROGRESS" ? "selected" : ""}>In progress</option>
          <option value="DONE" ${state.statusFilter === "DONE" ? "selected" : ""}>Done</option>
        </select>
      </div>
      <div class="task-grid">
        ${visibleTasks.map(renderTaskCard).join("") || `<div class="empty">No tasks match this view.</div>`}
      </div>
    </section>
  `;
}

function renderTaskCard(task) {
  const canChangeStatus = isAdmin() || task.assigneeId === state.user.id;
  return `
    <article class="task-card ${isOverdue(task) ? "overdue" : ""}">
      <div class="task-top">
        <div class="task-title">
          <strong>${escapeHtml(task.title)}</strong>
          <span class="muted">${escapeHtml(task.projectName)} - ${escapeHtml(task.assigneeName || "Unassigned")}</span>
        </div>
        <div class="task-meta">
          ${renderStatusPill(task.status)}
          ${renderPriorityPill(task.priority)}
          ${task.dueDate ? `<span class="pill ${isOverdue(task) ? "high" : ""}">Due ${escapeHtml(task.dueDate)}</span>` : ""}
        </div>
      </div>
      ${task.description ? `<p class="muted">${escapeHtml(task.description)}</p>` : ""}
      <div class="task-actions">
        ${
          canChangeStatus
            ? `
              <select class="status-select" data-action="task-status" data-id="${escapeHtml(task.id)}">
                <option value="TODO" ${task.status === "TODO" ? "selected" : ""}>To do</option>
                <option value="IN_PROGRESS" ${task.status === "IN_PROGRESS" ? "selected" : ""}>In progress</option>
                <option value="DONE" ${task.status === "DONE" ? "selected" : ""}>Done</option>
              </select>
            `
            : `<span class="muted">Status updates are limited to the assignee.</span>`
        }
        ${isAdmin() ? `<button class="button danger" type="button" data-action="delete-task" data-id="${escapeHtml(task.id)}">Delete</button>` : ""}
      </div>
    </article>
  `;
}

function renderStatusPill(status) {
  const className = status === "DONE" ? "done" : status === "IN_PROGRESS" ? "progressing" : "todo";
  return `<span class="pill ${className}">${escapeHtml(statusLabels[status] || status)}</span>`;
}

function renderPriorityPill(priority) {
  const className = String(priority || "MEDIUM").toLowerCase();
  return `<span class="pill ${className}">${escapeHtml(priorityLabels[priority] || priority)}</span>`;
}

function isOverdue(task) {
  return Boolean(task.dueDate && task.dueDate < todayString() && task.status !== "DONE");
}

function formValue(form, key) {
  return String(new FormData(form).get(key) || "").trim();
}

app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;

  try {
    if (action === "auth-mode") {
      state.authMode = button.dataset.mode;
      renderAuth();
      return;
    }

    if (action === "logout") {
      localStorage.removeItem(tokenKey);
      state.token = null;
      state.user = null;
      state.selectedProjectId = "all";
      renderAuth();
      return;
    }

    if (action === "reload") {
      await loadData();
      showToast("Workspace refreshed.");
      return;
    }

    if (action === "select-project") {
      state.selectedProjectId = button.dataset.id;
      await loadData();
      return;
    }

    if (action === "delete-project") {
      if (!confirm("Delete this project and all of its tasks?")) return;
      await api(`/projects/${button.dataset.id}`, { method: "DELETE" });
      state.selectedProjectId = "all";
      await loadData();
      showToast("Project deleted.");
      return;
    }

    if (action === "remove-member") {
      await api(`/projects/${state.selectedProjectId}/members/${button.dataset.userId}`, {
        method: "DELETE"
      });
      await loadData();
      showToast("Member removed.");
      return;
    }

    if (action === "delete-task") {
      if (!confirm("Delete this task?")) return;
      await api(`/tasks/${button.dataset.id}`, { method: "DELETE" });
      await loadData();
      showToast("Task deleted.");
    }
  } catch (error) {
    showToast(error.message);
  }
});

app.addEventListener("change", async (event) => {
  const target = event.target;

  try {
    if (target.id === "status-filter") {
      state.statusFilter = target.value;
      renderApp();
      return;
    }

    if (target.dataset.action === "task-status") {
      await api(`/tasks/${target.dataset.id}`, {
        method: "PATCH",
        body: { status: target.value }
      });
      await loadData();
      showToast("Task status updated.");
    }
  } catch (error) {
    showToast(error.message);
    await loadData();
  }
});

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;

  try {
    if (form.id === "auth-form") {
      const payload = {
        email: formValue(form, "email"),
        password: formValue(form, "password")
      };

      if (state.authMode === "signup") {
        payload.name = formValue(form, "name");
      }

      const route = state.authMode === "signup" ? "/auth/signup" : "/auth/login";
      const data = await api(route, { method: "POST", body: payload });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem(tokenKey, data.token);
      await loadData();
      showToast(`Signed in as ${data.user.role}.`);
      return;
    }

    if (form.id === "project-form") {
      const formData = new FormData(form);
      await api("/projects", {
        method: "POST",
        body: {
          name: formValue(form, "name"),
          description: formValue(form, "description"),
          memberIds: formData.getAll("memberIds").filter(Boolean)
        }
      });
      form.reset();
      await loadData();
      showToast("Project created.");
      return;
    }

    if (form.id === "member-form") {
      await api(`/projects/${state.selectedProjectId}/members`, {
        method: "POST",
        body: { userId: formValue(form, "userId") }
      });
      form.reset();
      await loadData();
      showToast("Member added.");
      return;
    }

    if (form.id === "task-form") {
      await api("/tasks", {
        method: "POST",
        body: {
          projectId: formValue(form, "projectId"),
          title: formValue(form, "title"),
          description: formValue(form, "description"),
          assigneeId: formValue(form, "assigneeId") || null,
          priority: formValue(form, "priority"),
          dueDate: formValue(form, "dueDate") || null
        }
      });
      form.reset();
      await loadData();
      showToast("Task created.");
    }
  } catch (error) {
    showToast(error.message);
  }
});

bootstrap();
