const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "..", "data", "smoke-test.sqlite");
fs.rmSync(dbPath, { force: true });
fs.rmSync(`${dbPath}-shm`, { force: true });
fs.rmSync(`${dbPath}-wal`, { force: true });

process.env.DB_FILE = dbPath;
process.env.JWT_SECRET = "smoke-test-secret";

const app = require("../server");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(baseUrl, route, options = {}, token) {
  const headers = {
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.body) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers
  });

  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(`${route} failed: ${data?.message || response.statusText}`);
  }

  return data;
}

const server = app.listen(0, async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const health = await request(baseUrl, "/health");
    assert(health.ok, "Health check did not return ok.");

    const adminSignup = await request(baseUrl, "/auth/signup", {
      method: "POST",
      body: {
        name: "Smoke Admin",
        email: "smoke-admin@example.com",
        password: "secret123"
      }
    });
    assert(adminSignup.user.role === "ADMIN", "First signup should be admin.");

    const memberSignup = await request(baseUrl, "/auth/signup", {
      method: "POST",
      body: {
        name: "Smoke Member",
        email: "smoke-member@example.com",
        password: "secret123"
      }
    });
    assert(memberSignup.user.role === "MEMBER", "Second signup should be member.");

    const projectResponse = await request(
      baseUrl,
      "/projects",
      {
        method: "POST",
        body: {
          name: "Smoke Project",
          description: "API smoke test project",
          memberIds: [memberSignup.user.id]
        }
      },
      adminSignup.token
    );
    assert(projectResponse.project.id, "Project was not created.");

    const taskResponse = await request(
      baseUrl,
      "/tasks",
      {
        method: "POST",
        body: {
          projectId: projectResponse.project.id,
          title: "Smoke task",
          assigneeId: memberSignup.user.id,
          priority: "HIGH",
          dueDate: "2099-01-01"
        }
      },
      adminSignup.token
    );
    assert(taskResponse.task.id, "Task was not created.");

    const updatedTask = await request(
      baseUrl,
      `/tasks/${taskResponse.task.id}`,
      {
        method: "PATCH",
        body: { status: "IN_PROGRESS" }
      },
      memberSignup.token
    );
    assert(updatedTask.task.status === "IN_PROGRESS", "Member could not update assigned task status.");

    const dashboard = await request(baseUrl, "/dashboard", {}, adminSignup.token);
    assert(dashboard.stats.totalTasks === 1, "Dashboard task count is incorrect.");

    console.log("Smoke test passed.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
