// API Base URL
const API_BASE = '/api';

// State
let currentUserId = null;
let currentProjectId = null;
let users = [];
let projects = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadUsers();
    loadProjects();
    loadStats();
    
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
    
    // Refresh data every 30 seconds
    setInterval(() => {
        loadStats();
        if (currentProjectId) {
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
        throw new Error(`API call failed: ${response.statusText}`);
    }
    
    if (method === 'DELETE') {
        return null;
    }
    
    return await response.json();
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
    const selects = [
        document.getElementById('currentUser'),
        document.getElementById('taskAssignee')
    ];
    
    selects.forEach(select => {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Select User</option>';
        
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.display_name;
            select.appendChild(option);
        });
        
        if (currentValue) {
            select.value = currentValue;
        }
    });
    
    // Restore current user
    if (currentUserId) {
        document.getElementById('currentUser').value = currentUserId;
    }
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

// Projects
async function loadProjects() {
    try {
        projects = await apiCall('/projects');
        displayProjects();
        loadStats();
    } catch (error) {
        console.error('Failed to load projects:', error);
    }
}

function displayProjects() {
    const container = document.getElementById('projectsList');
    
    if (projects.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d;">No projects yet. Create one to get started!</p>';
        return;
    }
    
    container.innerHTML = projects.map(project => `
        <div class="project-card" onclick="selectProject(${project.id})">
            <h3>${escapeHtml(project.name)}</h3>
            <p>${escapeHtml(project.description || 'No description')}</p>
            <div class="task-count">📋 ${project.task_count} tasks</div>
        </div>
    `).join('');
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
    const project = projects.find(p => p.id === projectId);
    
    document.getElementById('projectTitle').textContent = project.name;
    document.getElementById('projectsList').parentElement.style.display = 'none';
    document.getElementById('tasksView').style.display = 'block';
    
    loadTasks(projectId);
}

// Tasks
async function loadTasks(projectId) {
    try {
        const tasks = await apiCall(`/projects/${projectId}/tasks`);
        displayTasks(tasks);
    } catch (error) {
        console.error('Failed to load tasks:', error);
    }
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
        
        return `
        <div class="task-card status-${task.status}" onclick="showTaskDetail(${task.id})">
            <div class="task-info">
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-meta">
                    <span class="priority-badge priority-${task.priority}">
                        ${task.priority.toUpperCase()}
                    </span>
                    ${task.assignee_name ? `
                        <span class="task-assignee" style="background: ${task.assignee_color}">
                            👤 ${escapeHtml(task.assignee_name)}
                        </span>
                    ` : '<span style="color: #95a5a6">Unassigned</span>'}
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
                        ${task.assignee_name ? `
                            <span class="task-assignee" style="background: ${task.assignee_color}">
                                👤 Assigned to ${escapeHtml(task.assignee_name)}
                            </span>
                        ` : ''}
                    </div>
                    
                    ${timeSection}
                    
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
                                <button class="btn-icon-delete" onclick="deleteImage(${img.id}, ${task.id})" title="Delete image">
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
    }
}

async function changeTaskStatus(taskId, newStatus) {
    try {
        await apiCall(`/tasks/${taskId}`, 'PUT', { status: newStatus });
        closeModal('taskDetailModal');
        loadTasks(currentProjectId);
        loadStats();
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
        loadStats();
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
    showModal('taskModal');
}

async function handleTaskSubmit(e) {
    e.preventDefault();
    
    if (!currentUserId) {
        showNotification('Please select a user first', 'error');
        return;
    }
    
    const estimatedCompletion = document.getElementById('taskEstimatedCompletion').value;
    
    const data = {
        title: document.getElementById('taskTitle').value,
        description: document.getElementById('taskDescription').value,
        status: document.getElementById('taskStatus').value,
        priority: document.getElementById('taskPriority').value,
        assigned_to: parseInt(document.getElementById('taskAssignee').value) || null,
        created_by: currentUserId,
        estimated_completion: estimatedCompletion || null
    };
    
    try {
        await apiCall(`/projects/${currentProjectId}/tasks`, 'POST', data);
        closeModal('taskModal');
        document.getElementById('taskForm').reset();
        loadTasks(currentProjectId);
        loadStats();
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

// Statistics
async function loadStats() {
    try {
        const stats = await apiCall('/stats');
        
        document.getElementById('totalProjects').textContent = stats.total_projects;
        document.getElementById('totalTasks').textContent = stats.total_tasks;
        document.getElementById('startingTasks').textContent = stats.by_status.starting || 0;
        document.getElementById('inProgressTasks').textContent = stats.by_status.in_progress || 0;
        document.getElementById('ongoingTasks').textContent = stats.by_status.ongoing || 0;
        document.getElementById('doneTasks').textContent = stats.by_status.done || 0;
    } catch (error) {
        console.error('Failed to load stats:', error);
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
    // Simple notification system
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
