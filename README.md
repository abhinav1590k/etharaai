# Team Task Manager

A full-stack task management app for teams. Users can sign up, log in, create projects, add team members, assign tasks, and track progress from a dashboard. The first registered account is automatically created as `ADMIN`; every later signup starts as `MEMBER`.

## Submission Links

- Live Application URL: https://team-task-manager-production-e539.up.railway.app
- GitHub Repository: https://github.com/PSNarang4/Team-Task-Manager--Ethara.AI.git

## Features

- JWT authentication with signup and login
- Admin/Member role-based access control
- Project creation and team membership
- Task creation, assignment, priority, due date, and status tracking
- Dashboard metrics for tasks, completion, status, due soon, and overdue work
- REST API backed by a SQLite relational database
- Railway-ready configuration

## Tech Stack

- Node.js
- Express.js
- SQLite with `better-sqlite3`
- JWT auth
- bcrypt password hashing
- Zod request validation
- Vanilla HTML/CSS/JavaScript frontend

## Local Setup

```bash
npm install
cp .env.example .env
npm run seed
npm start
```

Open `http://localhost:3000`.

Demo accounts after seeding:

- Admin: `admin@example.com` / `admin123`
- Member: `member@example.com` / `member123`

## Scripts

```bash
npm start       # start production server
npm run dev     # start with Node watch mode
npm run seed    # seed demo users, project, and tasks
npm run smoke   # run API smoke test
```

## Railway Deployment

1. Push this folder to a GitHub repository.
2. Create a new Railway project from that GitHub repository.
3. Add these environment variables:
   - `JWT_SECRET`: a long random secret
   - Optional `DB_FILE`: leave unset if using a Railway volume
4. Add a Railway volume and mount it. The app automatically stores the SQLite database at `RAILWAY_VOLUME_MOUNT_PATH/team-task-manager.sqlite`.
5. Deploy. Railway will use `npm start` from `railway.json`.
6. Open the generated Railway URL and create the first account. That account becomes the admin.

## Main REST Endpoints

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users`
- `PATCH /api/users/:id/role`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/projects/:id/members`
- `DELETE /api/projects/:id/members/:userId`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `GET /api/dashboard`

## Role Rules

- Admins can create, update, and delete projects.
- Admins can add/remove team members.
- Admins can create, assign, update, and delete tasks.
- Members can view projects they belong to.
- Members can update the status of tasks assigned to them.

## Submission Checklist

- Live Application URL: https://team-task-manager-production-e539.up.railway.app
- GitHub Repository Link: https://github.com/PSNarang4/Team-Task-Manager--Ethara.AI.git
- README file: use `README.txt` for upload.
- Demo video: record login, project creation, team assignment, task assignment, member status update, and dashboard.
