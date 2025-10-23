# TaskMaster - Collaborative Task Management for Home Assistant

A complete, full-featured task management system designed as a Home Assistant add-on, enabling multi-user collaboration, date/time tracking, image uploads, and deep integration with Home Assistant automations.

## Features

### 🎯 Core Task Management
- **Multi-user collaboration** - Multiple users can work on projects together
- **Color-coded status system** with 4 states:
  - 🚀 **Starting** (Blue) - Tasks just beginning
  - ⚡ **In Progress** (Orange) - Actively being worked on
  - 🔄 **Ongoing** (Purple) - Continuous/recurring work
  - ✅ **Done** (Green) - Completed tasks
- **Priority levels** (Low, Medium, High)
- **Task assignment** - Assign tasks to specific users
- **Notes & Comments** - Each task can have multiple notes from different users
- **User attribution** - Every note shows who wrote it with color coding

### 📅 Date & Time Tracking
- **Automatic timestamps** - Created, started, and completed dates
- **Estimated completion** - Set and update target finish times
- **Time remaining** - Real-time calculation of days/hours until deadline
- **Overdue warnings** - Visual alerts when past estimated completion
- **Full timeline view** - See complete task history

### 📷 Image Upload System
- **Multiple images per task** - Upload unlimited images
- **Shared visibility** - All team members see all images
- **Image gallery** - Beautiful grid display
- **User attribution** - Shows who uploaded each image
- **Full-size preview** - Click to view images in full resolution
- **Supported formats** - PNG, JPG, JPEG, GIF, WEBP, BMP (up to 16MB)

### 🏠 Home Assistant Integration
- **Real-time events** fired for:
  - Task creation
  - Status changes
  - Task assignment
  - Note additions
  - Image uploads
  - Project creation
- **REST API sensors** for statistics
- **Automation triggers** based on task states
- **Notification support** via Home Assistant
- **State sensors** for tracking task counts

### 📊 Dashboard & UI
- Beautiful, responsive web interface
- Real-time statistics dashboard
- Color-coded task cards
- Project organization
- User management with custom colors
- Note threading on tasks
- Image galleries

## Installation

### Method 1: Manual Installation

1. Copy the entire `taskmaster-addon` folder to your Home Assistant add-ons directory:
```
   /addons/taskmaster-addon/
```

2. Restart Home Assistant

3. Navigate to **Settings → Add-ons → Add-on Store**

4. Click the menu (three dots) and select **Reload**

5. You should see **TaskMaster** in your local add-ons

6. Click on TaskMaster and then **Install**

7. Start the add-on

8. Access the interface at: `http://homeassistant.local:8099`

## Quick Start Guide

### 1. Create Users
First, create users who will be collaborating on projects:
- Click **+ User** button
- Enter username and display name
- Choose a color for the user (used for visual identification)
- Submit

### 2. Select Active User
- Use the user dropdown in the header to select who you are
- This determines who creates tasks and adds notes

### 3. Create a Project
- Click **+ Project** button
- Enter project name and description
- Submit

### 4. Add Tasks
- Click on a project card to open it
- Click **+ Add Task**
- Fill in task details:
  - Title and description
  - Status (starting, in progress, ongoing, or done)
  - Priority (low, medium, high)
  - Assign to a user (optional)
  - Set estimated completion date/time (optional)
- Submit

### 5. Manage Tasks
- Click on any task card to view details
- Change status with the status buttons
- Update estimated completion time
- Upload images (📷 Upload Images button)
- Add notes and comments
- View complete timeline

## Home Assistant Integration

### Events

TaskMaster fires these events that can trigger automations:

#### `taskmaster_task_created`
```yaml
event_data:
  task_id: 123
  project_id: 1
  title: "Task title"
  status: "starting"
  assigned_to: 1
```

#### `taskmaster_task_status_changed`
```yaml
event_data:
  task_id: 123
  title: "Task title"
  old_status: "starting"
  new_status: "in_progress"
```

#### `taskmaster_image_uploaded`
```yaml
event_data:
  task_id: 123
  image_id: 456
  user_id: 1
  filename: "kitchen_before.jpg"
```

### Example Automations

#### Send notification when task is completed
```yaml
automation:
  - alias: "Task Completed"
    trigger:
      - platform: event
        event_type: taskmaster_task_status_changed
        event_data:
          new_status: done
    action:
      - service: notify.mobile_app_your_phone
        data:
          title: "Task Done! 🎉"
          message: "{{ trigger.event.data.title }} is complete"
```

#### Turn on desk light when starting work
```yaml
automation:
  - alias: "Work Mode"
    trigger:
      - platform: event
        event_type: taskmaster_task_status_changed
        event_data:
          new_status: in_progress
    action:
      - service: light.turn_on
        target:
          entity_id: light.desk_lamp
        data:
          brightness: 255
```

## API Documentation

### Base URL
```
http://localhost:8099/api
```

### Endpoints

#### Users
- `GET /api/users` - List all users
- `POST /api/users` - Create user
- `GET /api/users/:id` - Get user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

#### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

#### Tasks
- `GET /api/projects/:id/tasks` - List project tasks
- `POST /api/projects/:id/tasks` - Create task
- `GET /api/tasks/:id` - Get task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

#### Notes
- `GET /api/tasks/:id/notes` - List task notes
- `POST /api/tasks/:id/notes` - Create note
- `PUT /api/notes/:id` - Update note
- `DELETE /api/notes/:id` - Delete note

#### Images
- `GET /api/tasks/:id/images` - List task images
- `POST /api/tasks/:id/images` - Upload image
- `DELETE /api/images/:id` - Delete image
- `GET /api/images/:id/download` - Download/view image

#### Statistics
- `GET /api/stats` - Get statistics

## Status Colors

| Status | Color | Hex | Description |
|--------|-------|-----|-------------|
| Starting | Blue | #3498db | Task is just beginning |
| In Progress | Orange | #f39c12 | Actively working on it |
| Ongoing | Purple | #9b59b6 | Continuous work |
| Done | Green | #27ae60 | Task completed |

## Data Storage

TaskMaster uses SQLite for data storage. The database is located at:
```
/data/taskmaster.db
```

Images are stored at:
```
/data/uploads/
```

This ensures your data persists across add-on restarts.

## License

MIT License

## Support

For issues and feature requests, please use the GitHub issue tracker.

## Version History

### v2.0.0
- Added date/time tracking (created, started, estimated, completed)
- Added image upload system
- Added time remaining calculator
- Added overdue warnings
- Added image gallery view
- Improved task detail view

### v1.0.0 (Initial Release)
- Multi-user collaboration
- Project and task management
- Notes system
- Color-coded statuses
- Home Assistant integration
- REST API
- Web interface
