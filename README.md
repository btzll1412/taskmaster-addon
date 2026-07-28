# TaskMaster v3 — Self-Hosted Work Management

A free, self-hosted, monday.com-style work management platform. Runs as a **Home Assistant add-on** or as a **standalone Docker container** — your data never leaves your network.

![Boards](https://img.shields.io/badge/version-3.0.0-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

### Built for service companies (MSP-ready)
- **Companies → Departments → Boards → Jobs → Sub-tasks** — model every customer in one system
- **Per-user access control**: grant an entire company, a department, a single board, or even one job
- **Three roles**: super admin (sees everything), company admin (runs their own company: its users, boards, and grants), member (sees only what was granted or assigned)
- Full **company isolation** — a customer can never see another customer's data
- **Automations**: "when Status becomes Stuck → notify these people" — per board, per label
- **@mentions & flagging** — ping anyone on a job from an update or the Flag button
- Being **assigned** to a job automatically makes it visible to you

### Boards, the monday.com way
- **Boards → Groups → Items** — organize any kind of work
- **Custom columns** — add any mix of column types to any board:
  - 🟢 **Status** — fully customizable labels & colors
  - 🚩 **Priority** — Critical / High / Medium / Low (customizable)
  - 👥 **People** — assign multiple teammates
  - 📅 **Date** — due dates with overdue highlighting
  - 🔤 **Text**, #️⃣ **Number**, 🏷️ **Dropdown/Tags**, ☑️ **Checkbox**
- **Table view** — spreadsheet-style with inline editing everywhere
- **Kanban view** — drag & drop cards between status lanes
- **Groups** — color-coded sections with collapse, rename, reorder

### Collaboration
- **Real user accounts** — username + password login, admin/member roles
- **Live sync** — changes from teammates appear instantly (server-sent events)
- **Updates & conversations** on every item
- **File & image uploads** with previews
- **Notifications** — get notified when you're assigned or mentioned in activity
- **Activity log** — full history per item and per board
- **My Work** — everything assigned to you across all boards, sorted by due date
- **Global search** — find any item or board instantly
- **Dark mode** 🌙

### Home Assistant integration
- Fires events for automations: `taskmaster_item_created`, `taskmaster_status_changed`, `taskmaster_board_created`
- Publishes a `sensor.taskmaster_items` statistics sensor
- Works fully standalone too — HA is optional

## 🚀 Installation

### Option A: Home Assistant add-on

1. Copy this repository folder to `/addons/taskmaster-addon/` on your Home Assistant machine
   (or add the repository URL in **Settings → Add-ons → Add-on Store → ⋮ → Repositories**).
2. **Settings → Add-ons → Add-on Store → ⋮ → Check for updates**, then install **TaskMaster**.
3. Start the add-on and open `http://homeassistant.local:8099`.

### Option B: Standalone Docker (no Home Assistant)

```bash
git clone https://github.com/btzll1412/taskmaster-addon.git
cd taskmaster-addon
docker compose up -d
```

Open `http://localhost:8099`.

### First run

The first visit shows a **setup screen** — create your admin account there. Then add your teammates under **avatar menu → Manage users**.

> **Upgrading from v2?** Your projects, tasks, notes, tags, assignees, and images are migrated to boards automatically on first start (the old tables are kept in the database as a backup). Migrated users have no password yet — after creating your admin account, set their passwords in **Manage users**. Tip: use your old v2 username for the admin account and it will be linked automatically.

## 🧑‍💻 Development

```bash
# Backend (Flask + SQLite)
pip install -r requirements.txt
DATA_DIR=./data python3 app.py            # serves API + built frontend on :8099

# Frontend (React + Vite)
cd frontend
npm install
npm run dev                               # dev server on :5173, proxies /api
npm run build                             # outputs to web/dist (committed)
```

## 🤖 Automation examples

```yaml
automation:
  - alias: "Notify when something is Done"
    trigger:
      - platform: event
        event_type: taskmaster_status_changed
        event_data:
          new_status: Done
    action:
      - service: notify.mobile_app_your_phone
        data:
          title: "Task done 🎉"
          message: "{{ trigger.event.data.name }} on {{ trigger.event.data.board }}"
```

See `HOMEASSISTANT_CONFIG.yaml` for more examples.

## 🔌 API

All endpoints live under `/api` and use session-cookie authentication (`POST /api/auth/login`). Highlights:

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/setup` · `login` · `logout` · `GET /api/auth/status` |
| Boards | `GET/POST /api/boards` · `GET/PUT/DELETE /api/boards/:id` |
| Groups & columns | `POST /api/boards/:id/groups` · `POST /api/boards/:id/columns` · `PUT/DELETE /api/groups/:id`, `/api/columns/:id` |
| Items | `POST /api/boards/:id/items` · `GET/PUT/DELETE /api/items/:id` · `PUT /api/items/:id/values/:columnId` |
| Collaboration | `POST /api/items/:id/updates` · `POST /api/items/:id/files` · `GET /api/notifications` |
| Views | `GET /api/my-work` · `GET /api/search?q=` · `GET /api/stats` |
| Real-time | `GET /api/events` (server-sent events) |

## 🗺️ Roadmap

- Calendar & timeline (Gantt) views
- LDAP / Active Directory login
- Email notifications
- More automation triggers (due dates, assignments)

## 📦 Data

Everything is stored in `/data` (SQLite database + uploads), which persists across restarts and updates.

## License

MIT
