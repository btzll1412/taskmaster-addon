// API Base URL
const API_BASE = '/api';

// State
let currentUserId = null;
let currentProjectId = null;
let currentProject = null;
let users = [];
let projects = [];
let currentView = 'dashboard';

// Dark Mode Management
function initDarkMode() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Apply saved theme or system preference
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.body.classList.add('dark-mode');
        updateThemeToggle(true);
    } else {
        document.body.classList.remove('dark-mode');
        updateThemeToggle(false);
    }
    
    // Remove loading class if present
    document.documentElement.classList.remove('dark-mode-loading');
}

function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeToggle(isDark);
}

function updateThemeToggle(isDark) {
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
        toggle.textContent = isDark ? '☀️' : '🌙';
        toggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    }
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const savedTheme = localStorage.getItem('theme');
    if (!savedTheme) {
        // Only auto-switch if user hasn't set preference
        if (e.matches) {
            document.body.classList.add('dark-mode');
            updateThemeToggle(true);
        } else {
            document.body.classList.remove('dark-mode');
            updateThemeToggle(false);
        }
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Initialize dark mode first
    initDarkMode();
    
    loadUsers();
    loadProjects();
    
    // Set up forms
    document.getElementById('userForm').addEventListener('submit', handleUserSubmit);
    document.getElementById('projectForm').addEventListener('submit', handleProjectSubmit);
    document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);
    
    // User selection
    document.getElementById('currentUser').addEventListener('change', (e) => {
        currentUserId = parseInt(e.target.value) || null;
        localStorage.setItem('currentUserId', currentUserId);
    });
    
    // Load saved user
    const savedUserId = localStorage.getItem('currentUserId');
    if (savedUserId) {
        currentUserId = parseInt(savedUserId);
    }
    
    // Show dashboard by default
    showDashboard();
    
    // Refresh data every 30 seconds
    setInterval(() => {
        if (currentView === 'dashboard') {
            loadProjects();
        } else if (currentView === 'tasks' && currentProjectId) {
            loadTasks(currentProjectId);
        }
    }, 30000);
});

// API Calls
async function apiCall(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    if (data) {
        options.body = JSON.stringify(data);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `API call failed: ${response.statusText}`);
    }
    
    if (method === 'DELETE') {
        return null;
    }
    
    return await response.json();
}

// View Navigation
function showDashboard() {
    currentView = 'dashboard';
    document.getElementById('dashboardView').style.display = 'block';
    document.getElementById('projectsPage').style.display = 'none';
    document.getElementById('tasksView').style.display = 'none';
    
    document.getElementById('dashboardBtn').classList.add('active');
    document.getElementById('projectsBtn').classList.remove('active');
    document.getElementById('myWorkBtn').classList.remove('active');
    
    loadProjects();
}

function showProjectsPage() {
    currentView = 'projects';
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('projectsPage').style.display = 'block';
    document.getElementById('tasksView').style.display = 'none';
    
    document.getElementById('dashboardBtn').classList.remove('active');
    document.getElementById('projectsBtn').classList.add('active');
    document.getElementById('myWorkBtn').classList.remove('active');
    
    // Reset filter
    const filterCheckbox = document.getElementById('myWorkFilter');
    if (filterCheckbox) {
        filterCheckbox.checked = false;
    }
    
    loadAllProjectsWithTasks();
}

function showMyWorkQuick() {
    if (!currentUserId) {
        showNotification('Please select a user first', 'error');
        return;
    }
    
    currentView = 'projects';
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('projectsPage').style.display = 'block';
    document.getElementById('tasksView').style.display = 'none';
    
    document.getElementById('dashboardBtn').classList.remove('active');
    document.getElementById('projectsBtn').classList.remove('active');
    document.getElementById('myWorkBtn').classList.add('active');
    
    // Enable filter
    const filterCheckbox = document.getElementById('myWorkFilter');
    if (filterCheckbox) {
        filterCheckbox.checked = true;
    }
    
    loadAllProjectsWithTasks();
}

function backToProjects() {
    showProjectsPage();
}

// Users
async function loadUsers() {
    try {
        users = await apiCall('/users');
        updateUserSelects();
    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

function updateUserSelects() {
    const currentUserSelect = document.getElementById('currentUser');
    const currentValue = currentUserSelect.value;
    
    currentUserSelect.innerHTML = '<option value="">Select User</option>';
    
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.display_name;
        currentUserSelect.appendChild(option);
    });
    
    if (currentValue) {
        currentUserSelect.value = currentValue;
    }
    
    // Restore current user
    if (currentUserId) {
        currentUserSelect.value = currentUserId;
    }
    
    // Update assignee checkboxes
    updateAssigneeCheckboxes();
    
    // Update users list in modal
    updateUsersListDisplay();
}

function updateUsersListDisplay() {
    const container = document.getElementById('usersList');
    if (!container) return;
    
    if (users.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d;">No users yet</p>';
        return;
    }
    
    container.innerHTML = users.map(user => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 8px; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div style="width: 30px; height: 30px; border-radius: 50%; background: ${user.color};"></div>
                <div>
                    <strong>${escapeHtml(user.display_name)}</strong>
                    <br><small style="color: #7f8c8d;">${escapeHtml(user.username)}</small>
                </div>
            </div>
            <button class="btn btn-danger" onclick="deleteUser(${user.id})" style="padding: 5px 15px; font-size: 12px;">
                Delete
            </button>
        </div>
    `).join('');
}

function updateAssigneeCheckboxes() {
    const container = document.getElementById('assigneeCheckboxes');
    if (!container) return;
    
    container.innerHTML = '';
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.innerHTML = `
            <input type="checkbox" id="assignee_${user.id}" value="${user.id}">
            <label for="assignee_${user.id}" style="color: ${user.color}">
                ${escapeHtml(user.display_name)}
            </label>
        `;
        container.appendChild(div);
    });
}

async function handleUserSubmit(e) {
    e.preventDefault();
    
    const data = {
        username: document.getElementById('username').value,
        display_name: document.getElementById('displayName').value,
        color: document.getElementById('userColor').value
    };
    
    try {
        await apiCall('/users', 'POST', data);
        closeModal('userModal');
        document.getElementById('userForm').reset();
        loadUsers();
        showNotification('User created successfully!', 'success');
    } catch (error) {
        showNotification('Failed to create user', 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? Their tasks and projects will be reassigned to another user.')) return;
    
    try {
        const response = await fetch(`${API_BASE}/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const data = await response.json().catch(() => ({}));
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to delete user');
        }
        
        closeModal('userModal');
        loadUsers();
        loadProjects(); // Reload projects since ownership changed
        
        showNotification(data.message || 'User deleted successfully', 'success');
    } catch (error) {
        showNotification(error.message || 'Failed to delete user', 'error');
    }
}

// Projects
async function loadProjects() {
    try {
        projects = await apiCall('/projects');
        
        if (currentView === 'dashboard') {
            displayDashboard();
        } else if (currentView === 'projects') {
            loadAllProjectsWithTasks();
        }
    } catch (error) {
        console.error('Failed to load projects:', error);
    }
}

function displayDashboard() {
    const activeProjects = projects.filter(p => p.status === 'active');
    const onHoldProjects = projects.filter(p => p.status === 'on_hold');
    const completedProjects = projects.filter(p => p.status === 'completed');
    
    // Update stats
    document.getElementById('activeProjects').textContent = activeProjects.length;
    document.getElementById('onHoldProjects').textContent = onHoldProjects.length;
    document.getElementById('completedProjects').textContent = completedProjects.length;
    
    const totalTasks = projects.reduce((sum, p) => sum + p.task_count, 0);
    document.getElementById('totalTasks').textContent = totalTasks;
    
    // Display projects by status
    displayProjectColumn('activeProjectsList', activeProjects);
    displayProjectColumn('onHoldProjectsList', onHoldProjects);
    displayProjectColumn('completedProjectsList', completedProjects);
}

function displayProjectColumn(elementId, projectsList) {
    const container = document.getElementById(elementId);
    
    if (projectsList.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d; padding: 10px;">No projects</p>';
        return;
    }
    
    container.innerHTML = projectsList.map(project => `
        <div class="project-card status-${project.status}" onclick="selectProject(${project.id})" style="margin-bottom: 10px;">
            <h3>${escapeHtml(project.name)}</h3>
            <div class="task-count">
                📋 ${project.task_count} tasks
                ${project.task_stats ? `
                    <br><small>
                        ✅ ${project.task_stats.done} | 
                        ⚡ ${project.task_stats.in_progress} | 
                        🔄 ${project.task_stats.ongoing}
                    </small>
                ` : ''}
            </div>
        </div>
    `).join('');
}

async function loadAllProjectsWithTasks() {
    try {
        const allProjects = await apiCall('/projects');
        
        // Load tasks for each project
        for (const project of allProjects) {
            const tasks = await apiCall(`/projects/${project.id}/tasks`);
            
            // Load assignees for each task
            for (const task of tasks) {
                try {
                    const assignments = await apiCall(`/tasks/${task.id}/assignments`);
                    task.assignees = assignments.map(a => ({
                        user_id: a.user_id,
                        username: a.username,
                        color: a.user_color
                    }));
                } catch (err) {
                    task.assignees = [];
                }
            }
            
            project.all_tasks = tasks;
        }
        
        displayFilteredProjects(allProjects);
    } catch (error) {
        console.error('Failed to load projects:', error);
        showNotification('Failed to load projects', 'error');
    }
}

function toggleMyWorkFilter() {
    const isFiltered = document.getElementById('myWorkFilter').checked;
    
    if (isFiltered && !currentUserId) {
        showNotification('Please select a user first', 'error');
        document.getElementById('myWorkFilter').checked = false;
        return;
    }
    
    loadAllProjectsWithTasks();
}

function displayFilteredProjects(allProjects) {
    const container = document.getElementById('allProjectsList');
    const filterCheckbox = document.getElementById('myWorkFilter');
    const isFiltered = filterCheckbox ? filterCheckbox.checked : false;
    
    let projectsToShow = allProjects;
    
    // Filter projects if "My Work" is checked
    if (isFiltered && currentUserId) {
        projectsToShow = allProjects.filter(project => {
            if (!project.all_tasks) return false;
            
            // Check if any task in this project is assigned to current user
            return project.all_tasks.some(task => {
                if (task.assignees && task.assignees.length > 0) {
                    return task.assignees.some(a => a.user_id === currentUserId);
                }
                return false;
            });
        });
    }
    
    if (projectsToShow.length === 0) {
        if (isFiltered) {
            container.innerHTML = '<p style="color: #7f8c8d;">No projects with tasks assigned to you</p>';
        } else {
            container.innerHTML = '<p style="color: #7f8c8d;">No projects yet. Create one to get started!</p>';
        }
        return;
    }
    
    container.innerHTML = projectsToShow.map(project => {
        // Calculate task stats
        let myTaskCount = project.task_count;
        let taskStats = project.task_stats || { starting: 0, in_progress: 0, ongoing: 0, done: 0 };
        
        if (isFiltered && currentUserId && project.all_tasks) {
            // Filter tasks assigned to me
            const myTasks = project.all_tasks.filter(task => {
                if (task.assignees && task.assignees.length > 0) {
                    return task.assignees.some(a => a.user_id === currentUserId);
                }
                return false;
            });
            
            myTaskCount = myTasks.length;
            taskStats = {
                starting: myTasks.filter(t => t.status === 'starting').length,
                in_progress: myTasks.filter(t => t.status === 'in_progress').length,
                ongoing: myTasks.filter(t => t.status === 'ongoing').length,
                done: myTasks.filter(t => t.status === 'done').length
            };
        }
        
        return `
        <div class="project-card status-${project.status}" onclick="selectProject(${project.id})">
            <div class="project-status-badge">${formatProjectStatus(project.status)}</div>
            <h3>${escapeHtml(project.name)}</h3>
            <p>${escapeHtml(project.description || 'No description')}</p>
            <div class="task-count">
                📋 ${myTaskCount} task${myTaskCount !== 1 ? 's' : ''}${isFiltered ? ' (assigned to you)' : ''}
                ${taskStats ? `
                    <br><small>
                        ✅ ${taskStats.done} | 
                        ⚡ ${taskStats.in_progress} | 
                        🔄 ${taskStats.ongoing} | 
                        🚀 ${taskStats.starting}
                    </small>
                ` : ''}
            </div>
        </div>
    `;
    }).join('');
}

async function handleProjectSubmit(e) {
    e.preventDefault();
    
    if (!currentUserId) {
        showNotification('Please select a user first', 'error');
        return;
    }
    
    const data = {
        name: document.getElementById('projectName').value,
        description: document.getElementById('projectDescription').value,
        status: document.getElementById('projectStatus').value,
        created_by: currentUserId
    };
    
    try {
        await apiCall('/projects', 'POST', data);
        closeModal('projectModal');
        document.getElementById('projectForm').reset();
        loadProjects();
        showNotification('Project created successfully!', 'success');
    } catch (error) {
        showNotification('Failed to create project', 'error');
    }
}

function selectProject(projectId) {
    currentProjectId = projectId;
    currentProject = projects.find(p => p.id === projectId);
    currentView = 'tasks';
    
    document.getElementById('projectTitle').textContent = currentProject.name;
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('projectsPage').style.display = 'none';
    document.getElementById('tasksView').style.display = 'block';
    
    document.getElementById('dashboardBtn').classList.remove('active');
    document.getElementById('projectsBtn').classList.remove('active');
    document.getElementById('myWorkBtn').classList.remove('active');
    
    // Show project status
    const statusBadges = document.getElementById('projectStatusBadges');
    statusBadges.innerHTML = `
        <span class="status-badge status-${currentProject.status}">
            ${formatProjectStatus(currentProject.status)}
        </span>
    `;
    
    loadTasks(projectId);
}

function showProjectStatusModal() {
    showModal('projectStatusModal');
}

async function changeProjectStatus(newStatus) {
    if (!currentProjectId) return;
    
    try {
        await apiCall(`/projects/${currentProjectId}`, 'PUT', { status: newStatus });
        closeModal('projectStatusModal');
        
        // Reload current project
        currentProject = await apiCall(`/projects/${currentProjectId}`);
        
        // Update status badge
        const statusBadges = document.getElementById('projectStatusBadges');
        statusBadges.innerHTML = `
            <span class="status-badge status-${currentProject.status}">
                ${formatProjectStatus(currentProject.status)}
            </span>
        `;
        
        showNotification('Project status updated!', 'success');
    } catch (error) {
        showNotification('Failed to update project status', 'error');
    }
}

function formatProjectStatus(status) {
    const statusMap = {
        'active': '🚀 Active',
        'on_hold': '⏸️ On Hold',
        'completed': '✅ Completed'
    };
    return statusMap[status] || status;
}

// Tasks
async function loadTasks(projectId) {
    try {
        const tasks = await apiCall(`/projects/${projectId}/tasks`);
        displayTasks(tasks);
        updateProjectTaskStats(tasks);
    } catch (error) {
        console.error('Failed to load tasks:', error);
    }
}

function updateProjectTaskStats(tasks) {
    const stats = {
        starting: tasks.filter(t => t.status === 'starting').length,
        in_progress: tasks.filter(t => t.status === 'in_progress').length,
        ongoing: tasks.filter(t => t.status === 'ongoing').length,
        done: tasks.filter(t => t.status === 'done').length
    };
    
    document.getElementById('projectStartingTasks').textContent = stats.starting;
    document.getElementById('projectInProgressTasks').textContent = stats.in_progress;
    document.getElementById('projectOngoingTasks').textContent = stats.ongoing;
    document.getElementById('projectDoneTasks').textContent = stats.done;
}

function displayTasks(tasks) {
    const container = document.getElementById('tasksList');
    
    if (tasks.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d;">No tasks yet. Create one to get started!</p>';
        return;
    }
    
    container.innerHTML = tasks.map(task => {
        let timeInfo = '';
        if (task.started_at) {
            timeInfo += `<span>⏱️ Started: ${formatDate(task.started_at)}</span>`;
        }
        if (task.estimated_completion) {
            const estDate = new Date(task.estimated_completion);
            const now = new Date();
            const isOverdue = estDate < now && task.status !== 'done';
            timeInfo += `<span style="${isOverdue ? 'color: #e74c3c; font-weight: bold;' : ''}">📅 Est: ${formatDate(task.estimated_completion)}</span>`;
        }
        if (task.completed_at) {
            timeInfo += `<span>✅ Done: ${formatDate(task.completed_at)}</span>`;
        }
        
        // Display assignees
        let assigneesHtml = '';
        if (task.assignees && task.assignees.length > 0) {
            assigneesHtml = '<div class="task-assignees">';
            task.assignees.forEach(assignee => {
                assigneesHtml += `
                    <span class="task-assignee" style="background: ${assignee.color}">
                        👤 ${escapeHtml(assignee.username)}
                    </span>
                `;
            });
            assigneesHtml += '</div>';
        } else if (task.assignee_name) {
            assigneesHtml = `
                <span class="task-assignee" style="background: ${task.assignee_color}">
                    👤 ${escapeHtml(task.assignee_name)}
                </span>
            `;
        } else {
            assigneesHtml = '<span style="color: #95a5a6">Unassigned</span>';
        }
        
        return `
        <div class="task-card status-${task.status}" onclick="showTaskDetail(${task.id})">
            <div class="task-info">
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-meta">
                    <span class="priority-badge priority-${task.priority}">
                        ${task.priority.toUpperCase()}
                    </span>
                    ${assigneesHtml}
                    <span>💬 ${task.note_count} notes</span>
                    <span>📷 ${task.image_count} images</span>
                </div>
                ${timeInfo ? `<div class="task-meta" style="margin-top: 5px;">${timeInfo}</div>` : ''}
            </div>
            <div>
                <span class="status-badge status-${task.status}">
                    ${formatStatus(task.status)}
                </span>
            </div>
        </div>
    `;
    }).join('');
}

async function showTaskDetail(taskId) {
    try {
        const task = await apiCall(`/tasks/${taskId}`);
        const notes = await apiCall(`/tasks/${taskId}/notes`);
        const images = await apiCall(`/tasks/${taskId}/images`);
        const assignments = await apiCall(`/tasks/${taskId}/assignments`);
        
        // Calculate time information
        let timeSection = '<div class="time-tracking">';
        timeSection += `<p><strong>Created:</strong> ${formatDate(task.created_at)}</p>`;
        if (task.started_at) {
            timeSection += `<p><strong>Started:</strong> ${formatDate(task.started_at)}</p>`;
        }
        if (task.estimated_completion) {
            const estDate = new Date(task.estimated_completion);
            const now = new Date();
            const isOverdue = estDate < now && task.status !== 'done';
            timeSection += `<p style="${isOverdue ? 'color: #e74c3c; font-weight: bold;' : ''}"><strong>Estimated Completion:</strong> ${formatDate(task.estimated_completion)}</p>`;
            
            // Show time remaining
            if (task.status !== 'done') {
                const diffMs = estDate - now;
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffHours / 24);
                
                if (diffMs < 0) {
                    timeSection += `<p style="color: #e74c3c; font-weight: bold;">⚠️ Overdue by ${Math.abs(diffDays)} days</p>`;
                } else if (diffDays > 0) {
                    timeSection += `<p style="color: #f39c12;">${diffDays} days remaining</p>`;
                } else {
                    timeSection += `<p style="color: #f39c12;">${diffHours} hours remaining</p>`;
                }
            }
        }
        if (task.completed_at) {
            timeSection += `<p style="color: #27ae60;"><strong>✅ Completed:</strong> ${formatDate(task.completed_at)}</p>`;
        }
        timeSection += '</div>';
        
        // Assignees section
        let assigneesSection = '<div class="assignees-section">';
        assigneesSection += '<h4>👥 Assigned To</h4>';
        assigneesSection += '<div class="assignees-list">';
        if (assignments.length > 0) {
            assignments.forEach(assignment => {
                assigneesSection += `
                    <div class="assignee-chip" style="background: ${assignment.user_color}">
                        ${escapeHtml(assignment.username)}
                        <button onclick="event.stopPropagation(); removeAssignee(${assignment.id}, ${taskId})">×</button>
                    </div>
                `;
            });
        } else {
            assigneesSection += '<p style="color: #7f8c8d;">No one assigned yet</p>';
        }
        assigneesSection += '</div>';
        
        // Add assignee form
        assigneesSection += '<div class="add-assignee-form">';
        assigneesSection += '<select id="newAssigneeSelect"><option value="">Select user to assign...</option>';
        users.forEach(user => {
            const alreadyAssigned = assignments.some(a => a.user_id === user.id);
            if (!alreadyAssigned) {
                assigneesSection += `<option value="${user.id}">${escapeHtml(user.display_name)}</option>`;
            }
        });
        assigneesSection += '</select>';
        assigneesSection += `<button class="btn btn-primary" onclick="addAssignee(${taskId})">Add</button>`;
        assigneesSection += '</div>';
        assigneesSection += '</div>';
        
        // Update estimated completion section
        const estCompletionValue = task.estimated_completion ? new Date(task.estimated_completion).toISOString().slice(0, 16) : '';
        
        const detailHtml = `
            <div class="task-detail">
                <div class="task-detail-header">
                    <div class="task-detail-title">${escapeHtml(task.title)}</div>
                    <div class="task-detail-meta">
                        <span class="status-badge status-${task.status}">
                            ${formatStatus(task.status)}
                        </span>
                        <span class="priority-badge priority-${task.priority}">
                            ${task.priority.toUpperCase()} PRIORITY
                        </span>
                    </div>
                    
                    ${timeSection}
                    
                    ${assigneesSection}
                    
                    <div class="time-update">
                        <label><strong>Update Estimated Completion:</strong></label>
                        <input type="datetime-local" id="updateEstimatedCompletion" value="${estCompletionValue}">
                        <button class="btn btn-secondary" onclick="updateTaskEstimation(${task.id})">
                            Update Estimation
                        </button>
                    </div>
                    
                    <div class="task-actions">
                        <button class="btn btn-primary" onclick="changeTaskStatus(${task.id}, 'starting')">
                            Starting
                        </button>
                        <button class="btn btn-primary" onclick="changeTaskStatus(${task.id}, 'in_progress')">
                            In Progress
                        </button>
                        <button class="btn btn-primary" onclick="changeTaskStatus(${task.id}, 'ongoing')">
                            Ongoing
                        </button>
                        <button class="btn btn-success" onclick="changeTaskStatus(${task.id}, 'done')">
                            ✓ Done
                        </button>
                        <button class="btn btn-danger" onclick="deleteTask(${task.id})">
                            Delete
                        </button>
                    </div>
                </div>
                
                ${task.description ? `
                    <div class="task-description">
                        <strong>Description:</strong><br>
                        ${escapeHtml(task.description)}
                    </div>
                ` : ''}
                
                <div class="images-section">
                    <h3>📷 Images (${images.length})</h3>
                    <div class="image-upload">
                        <input type="file" id="imageUpload" accept="image/*" multiple style="display: none;">
                        <button class="btn btn-primary" onclick="document.getElementById('imageUpload').click()">
                            📷 Upload Images
                        </button>
                    </div>
                    <div class="images-gallery" id="imagesGallery">
                        ${images.map(img => `
                            <div class="image-card">
                                <img src="${img.url}" alt="${escapeHtml(img.original_filename)}" 
                                     onclick="window.open('${img.url}', '_blank')">
                                <div class="image-info">
                                    <span style="color: ${img.user_color}; font-weight: 600;">
                                        ${escapeHtml(img.username)}
                                    </span>
                                    <span style="font-size: 11px; color: #7f8c8d;">
                                        ${formatDate(img.created_at)}
                                    </span>
                                </div>
                                <button class="btn-icon-delete" onclick="event.stopPropagation(); deleteImage(${img.id}, ${task.id})" title="Delete image">
                                    🗑️
                                </button>
                            </div>
                        `).join('') || '<p style="color: #7f8c8d;">No images yet</p>'}
                    </div>
                </div>
                
                <div class="notes-section">
                    <h3>💬 Notes & Comments</h3>
                    <div class="note-form">
                        <textarea id="noteContent" placeholder="Add a note..."></textarea>
                        <button class="btn btn-primary" onclick="addNote(${task.id})">
                            Add Note
                        </button>
                    </div>
                    <div class="notes-list" id="notesList">
                        ${notes.map(note => `
                            <div class="note-card" style="border-left-color: ${note.user_color}">
                                <div class="note-header">
                                    <span class="note-author" style="color: ${note.user_color}">
                                        ${escapeHtml(note.username)}
                                    </span>
                                    <span class="note-date">
                                        ${formatDate(note.created_at)}
                                    </span>
                                </div>
                                <div class="note-content">
                                    ${escapeHtml(note.content)}
                                </div>
                            </div>
                        `).join('') || '<p style="color: #7f8c8d;">No notes yet</p>'}
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('taskDetail').innerHTML = detailHtml;
        
        // Set up image upload handler
        document.getElementById('imageUpload').addEventListener('change', (e) => {
            uploadImages(taskId, e.target.files);
        });
        
        showModal('taskDetailModal');
    } catch (error) {
        showNotification('Failed to load task details', 'error');
        console.error(error);
    }
}

async function addAssignee(taskId) {
    const userId = document.getElementById('newAssigneeSelect').value;
    
    if (!userId) {
        showNotification('Please select a user', 'error');
        return;
    }
    
    if (!currentUserId) {
        showNotification('Please select yourself as current user first', 'error');
        return;
    }
    
    try {
        await apiCall(`/tasks/${taskId}/assignments`, 'POST', {
            user_id: parseInt(userId),
            assigned_by: currentUserId
        });
        
        showTaskDetail(taskId);
        loadTasks(currentProjectId);
        showNotification('User assigned!', 'success');
    } catch (error) {
        showNotification(error.message || 'Failed to assign user', 'error');
    }
}

async function removeAssignee(assignmentId, taskId) {
    if (!confirm('Remove this person from the task?')) return;
    
    try {
        await apiCall(`/assignments/${assignmentId}`, 'DELETE');
        showTaskDetail(taskId);
        loadTasks(currentProjectId);
        showNotification('User removed from task', 'success');
    } catch (error) {
        showNotification('Failed to remove user', 'error');
    }
}

async function changeTaskStatus(taskId, newStatus) {
    try {
        await apiCall(`/tasks/${taskId}`, 'PUT', { status: newStatus });
        closeModal('taskDetailModal');
        loadTasks(currentProjectId);
        showNotification('Task status updated!', 'success');
    } catch (error) {
        showNotification('Failed to update task', 'error');
    }
}

async function deleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this task?')) {
        return;
    }
    
    try {
        await apiCall(`/tasks/${taskId}`, 'DELETE');
        closeModal('taskDetailModal');
        loadTasks(currentProjectId);
        showNotification('Task deleted', 'success');
    } catch (error) {
        showNotification('Failed to delete task', 'error');
    }
}

function showTaskModal() {
    if (!currentUserId) {
        showNotification('Please select a user first', 'error');
        return;
    }
    updateAssigneeCheckboxes();
    showModal('taskModal');
}

async function handleTaskSubmit(e) {
    e.preventDefault();
    
    if (!currentUserId) {
        showNotification('Please select a user first', 'error');
        return;
    }
    
    const estimatedCompletion = document.getElementById('taskEstimatedCompletion').value;
    
    // Get selected assignees (OPTIONAL)
    const selectedAssignees = [];
    document.querySelectorAll('#assigneeCheckboxes input[type="checkbox"]:checked').forEach(checkbox => {
        selectedAssignees.push(parseInt(checkbox.value));
    });
    
    const data = {
        title: document.getElementById('taskTitle').value,
        description: document.getElementById('taskDescription').value,
        status: document.getElementById('taskStatus').value,
        priority: document.getElementById('taskPriority').value,
        assigned_to: null,  // Legacy field - always null now
        created_by: currentUserId,
        estimated_completion: estimatedCompletion || null
    };
    
    try {
        const task = await apiCall(`/projects/${currentProjectId}/tasks`, 'POST', data);
        
        // Assign all selected users (ONLY if any selected)
        if (selectedAssignees.length > 0) {
            for (const userId of selectedAssignees) {
                try {
                    await apiCall(`/tasks/${task.id}/assignments`, 'POST', {
                        user_id: userId,
                        assigned_by: currentUserId
                    });
                } catch (assignError) {
                    console.error('Failed to assign user:', assignError);
                }
            }
        }
        
        closeModal('taskModal');
        document.getElementById('taskForm').reset();
        loadTasks(currentProjectId);
        showNotification('Task created successfully!', 'success');
    } catch (error) {
        showNotification('Failed to create task', 'error');
    }
}

// Notes
async function addNote(taskId) {
    const content = document.getElementById('noteContent').value.trim();
    
    if (!content) {
        showNotification('Please enter a note', 'error');
        return;
    }
    
    if (!currentUserId) {
        showNotification('Please select a user first', 'error');
        return;
    }
    
    try {
        await apiCall(`/tasks/${taskId}/notes`, 'POST', {
            content: content,
            user_id: currentUserId
        });
        
        document.getElementById('noteContent').value = '';
        showTaskDetail(taskId);
        showNotification('Note added!', 'success');
    } catch (error) {
        showNotification('Failed to add note', 'error');
    }
}

// Image Upload Functions
async function uploadImages(taskId, files) {
    if (!currentUserId) {
        showNotification('Please select a user first', 'error');
        return;
    }
    
    if (files.length === 0) return;
    
    for (let file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', currentUserId);
        
        try {
            const response = await fetch(`/api/tasks/${taskId}/images`, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error('Upload failed');
            }
            
            showNotification(`Uploaded ${file.name}`, 'success');
        } catch (error) {
            showNotification(`Failed to upload ${file.name}`, 'error');
        }
    }
    
    // Refresh task detail to show new images
    setTimeout(() => showTaskDetail(taskId), 500);
}

async function deleteImage(imageId, taskId) {
    if (!confirm('Delete this image?')) return;
    
    try {
        await fetch(`/api/images/${imageId}`, { method: 'DELETE' });
        showNotification('Image deleted', 'success');
        showTaskDetail(taskId);
    } catch (error) {
        showNotification('Failed to delete image', 'error');
    }
}

async function updateTaskEstimation(taskId) {
    const estimatedCompletion = document.getElementById('updateEstimatedCompletion').value;
    
    try {
        await apiCall(`/tasks/${taskId}`, 'PUT', {
            estimated_completion: estimatedCompletion || null
        });
        
        showTaskDetail(taskId);
        loadTasks(currentProjectId);
        showNotification('Estimation updated!', 'success');
    } catch (error) {
        showNotification('Failed to update estimation', 'error');
    }
}

// Utility Functions
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 5px 20px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s;
        max-width: 400px;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function formatStatus(status) {
    const statusMap = {
        'starting': '🚀 Starting',
        'in_progress': '⚡ In Progress',
        'ongoing': '🔄 Ongoing',
        'done': '✅ Done'
    };
    return statusMap[status] || status;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close modals when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}
