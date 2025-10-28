#!/usr/bin/env python3
"""
TaskMaster - Collaborative Task Management for Home Assistant
"""
import os
import json
import requests
import uuid
from datetime import datetime
from werkzeug.utils import secure_filename
from flask import Flask, jsonify, request, send_from_directory, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS

app = Flask(__name__, static_folder='web', static_url_path='')
CORS(app)

# Database configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////data/taskmaster.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = '/data/uploads'

# Create upload folder if it doesn't exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Allowed file extensions for images
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'}

db = SQLAlchemy(app)

# Home Assistant API configuration
SUPERVISOR_TOKEN = os.environ.get('SUPERVISOR_TOKEN', '')
HA_URL = 'http://supervisor/core/api'

# Database Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    display_name = db.Column(db.String(120), nullable=False)
    color = db.Column(db.String(7), default='#3498db')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(20), default='active')  # active, on_hold, completed
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    title = db.Column(db.String(300), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(20), default='starting')  # starting, in_progress, ongoing, done
    assigned_to = db.Column(db.Integer, db.ForeignKey('user.id'))  # Legacy - keep for compatibility
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    priority = db.Column(db.String(20), default='medium')  # low, medium, high
    # Date/time tracking
    started_at = db.Column(db.DateTime)  # When work actually started
    estimated_completion = db.Column(db.DateTime)  # Estimated finish time
    completed_at = db.Column(db.DateTime)  # When task was marked done

class TaskAssignment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    assigned_at = db.Column(db.DateTime, default=datetime.utcnow)
    assigned_by = db.Column(db.Integer, db.ForeignKey('user.id'))

class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class TaskImage(db.Model):
    __tablename__ = 'task_images'
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    filename = db.Column(db.String(500), nullable=False)
    original_filename = db.Column(db.String(500), nullable=False)
    file_path = db.Column(db.String(1000), nullable=False)
    mime_type = db.Column(db.String(100))
    file_size = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# Tags - Both global and project-specific
class Tag(db.Model):
    __tablename__ = 'tags'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    color = db.Column(db.String(7), nullable=False, default='#3498db')  # Hex color
    project_id = db.Column(db.Integer, db.ForeignKey('project.id', ondelete='CASCADE'), nullable=True)  # NULL = global
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    project = db.relationship('Project', backref=db.backref('tags', lazy=True, cascade='all, delete-orphan'))
    creator = db.relationship('User', foreign_keys=[created_by], backref=db.backref('created_tags', lazy=True))
    
    # Ensure unique tag names per project (or global)
    __table_args__ = (
        db.UniqueConstraint('name', 'project_id', name='unique_tag_per_project'),
    )

# Task-Tag relationship (many-to-many)
class TaskTag(db.Model):
    __tablename__ = 'task_tags'
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id', ondelete='CASCADE'), nullable=False)
    tag_id = db.Column(db.Integer, db.ForeignKey('tags.id', ondelete='CASCADE'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    task = db.relationship('Task', backref=db.backref('task_tags_rel', lazy=True, cascade='all, delete-orphan'))
    tag = db.relationship('Tag', backref=db.backref('task_tags_rel', lazy=True, cascade='all, delete-orphan'))
    
    # Unique constraint - can't add same tag twice
    __table_args__ = (
        db.UniqueConstraint('task_id', 'tag_id', name='unique_task_tag'),
    )

# Subtasks/Checklist items
class Subtask(db.Model):
    __tablename__ = 'subtasks'
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id', ondelete='CASCADE'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    completed = db.Column(db.Boolean, default=False)
    position = db.Column(db.Integer, default=0)  # For ordering
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    task = db.relationship('Task', backref=db.backref('subtasks', lazy=True, cascade='all, delete-orphan', order_by='Subtask.position'))
    creator = db.relationship('User', foreign_keys=[created_by], backref=db.backref('created_subtasks', lazy=True))

# Activity Log - Track all changes
class ActivityLog(db.Model):
    __tablename__ = 'activity_log'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id', ondelete='SET NULL'), nullable=True)
    action_type = db.Column(db.String(50), nullable=False)  # 'created', 'updated', 'deleted', 'commented', etc.
    entity_type = db.Column(db.String(50), nullable=False)  # 'task', 'project', 'assignment', etc.
    entity_id = db.Column(db.Integer, nullable=False)
    old_value = db.Column(db.Text, nullable=True)
    new_value = db.Column(db.Text, nullable=True)
    description = db.Column(db.Text, nullable=False)  # Human-readable description
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    user = db.relationship('User', backref=db.backref('activities', lazy=True))
    
    # Index for faster queries
    __table_args__ = (
        db.Index('idx_activity_entity', 'entity_type', 'entity_id'),
        db.Index('idx_activity_user', 'user_id'),
        db.Index('idx_activity_created', 'created_at'),
    )

# Helper function to log activities
def log_activity(user_id, action_type, entity_type, entity_id, description, old_value=None, new_value=None):
    """
    Log an activity to the activity log
    
    Args:
        user_id: ID of user performing action
        action_type: Type of action ('created', 'updated', 'deleted', 'assigned', etc.)
        entity_type: Type of entity ('task', 'project', 'comment', etc.)
        entity_id: ID of the entity
        description: Human-readable description
        old_value: Previous value (for updates)
        new_value: New value (for updates)
    """
    try:
        activity = ActivityLog(
            user_id=user_id,
            action_type=action_type,
            entity_type=entity_type,
            entity_id=entity_id,
            old_value=old_value,
            new_value=new_value,
            description=description
        )
        db.session.add(activity)
        db.session.commit()
    except Exception as e:
        print(f"Failed to log activity: {e}")
        db.session.rollback()


# Initialize database
with app.app_context():
    db.create_all()
    
    # Create indexes for better performance
    try:
        with db.engine.connect() as conn:
            conn.execute(db.text('CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id)'))
            conn.execute(db.text('CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id)'))
            conn.execute(db.text('CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)'))
            conn.execute(db.text('CREATE INDEX IF NOT EXISTS idx_tags_project ON tags(project_id)'))
            conn.commit()
    except Exception as e:
        print(f"Indexes might already exist: {e}")
    
    print("Database initialized with all tables and indexes")

# Helper Functions
def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def notify_home_assistant(message, title="TaskMaster"):
    """Send notification to Home Assistant"""
    try:
        headers = {
            'Authorization': f'Bearer {SUPERVISOR_TOKEN}',
            'Content-Type': 'application/json'
        }
        data = {
            'message': message,
            'title': title
        }
        requests.post(f'{HA_URL}/services/persistent_notification/create', 
                     headers=headers, json=data, timeout=5)
    except Exception as e:
        print(f"Failed to send notification: {e}")

def fire_event(event_type, event_data):
    """Fire event in Home Assistant"""
    try:
        headers = {
            'Authorization': f'Bearer {SUPERVISOR_TOKEN}',
            'Content-Type': 'application/json'
        }
        requests.post(f'{HA_URL}/events/{event_type}', 
                     headers=headers, json=event_data, timeout=5)
    except Exception as e:
        print(f"Failed to fire event: {e}")

def update_sensor(entity_id, state, attributes=None):
    """Update sensor in Home Assistant"""
    try:
        headers = {
            'Authorization': f'Bearer {SUPERVISOR_TOKEN}',
            'Content-Type': 'application/json'
        }
        data = {
            'state': state,
            'attributes': attributes or {}
        }
        requests.post(f'{HA_URL}/states/{entity_id}', 
                     headers=headers, json=data, timeout=5)
    except Exception as e:
        print(f"Failed to update sensor: {e}")


# API Routes - Users
@app.route('/api/users', methods=['GET', 'POST'])
def handle_users():
    if request.method == 'POST':
        data = request.json
        user = User(
            username=data['username'],
            display_name=data['display_name'],
            color=data.get('color', '#3498db')
        )
        db.session.add(user)
        db.session.commit()
        
        fire_event('taskmaster_user_created', {'user_id': user.id, 'username': user.username})
        
        return jsonify({
            'id': user.id,
            'username': user.username,
            'display_name': user.display_name,
            'color': user.color
        }), 201
    
    users = User.query.all()
    return jsonify([{
        'id': u.id,
        'username': u.username,
        'display_name': u.display_name,
        'color': u.color
    } for u in users])

@app.route('/api/users/<int:user_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_user(user_id):
    user = User.query.get_or_404(user_id)
    
    if request.method == 'DELETE':
        # Check if this is the only user
        total_users = User.query.count()
        if total_users <= 1:
            return jsonify({
                'error': 'Cannot delete the only user in the system.'
            }), 400
        
        # Find another user to reassign to
        other_user = User.query.filter(User.id != user_id).first()
        
        if not other_user:
            return jsonify({
                'error': 'Cannot delete user. No other users available for reassignment.'
            }), 400
        
        # Reassign all tasks created by this user
        tasks_to_reassign = Task.query.filter_by(created_by=user_id).all()
        for task in tasks_to_reassign:
            task.created_by = other_user.id
        
        # Reassign all projects created by this user
        projects_to_reassign = Project.query.filter_by(created_by=user_id).all()
        for project in projects_to_reassign:
            project.created_by = other_user.id
        
       # Remove task assignments
        TaskAssignment.query.filter_by(user_id=user_id).delete()
        
        # Keep notes but reassign to other user
        notes_to_reassign = Note.query.filter_by(user_id=user_id).all()
        for note in notes_to_reassign:
            note.user_id = other_user.id
        
        # Keep images but reassign to other user
        images_to_reassign = TaskImage.query.filter_by(user_id=user_id).all()
        for image in images_to_reassign:
            image.user_id = other_user.id
        
        db.session.delete(user)
        db.session.commit()
        
        fire_event('taskmaster_user_deleted', {
            'user_id': user_id, 
            'username': user.username,
            'reassigned_to': other_user.display_name
        })
        
        return jsonify({
            'message': f'User deleted. Tasks and projects reassigned to {other_user.display_name}'
        }), 200
    
    if request.method == 'PUT':
        data = request.json
        user.display_name = data.get('display_name', user.display_name)
        user.color = data.get('color', user.color)
        db.session.commit()
    
    return jsonify({
        'id': user.id,
        'username': user.username,
        'display_name': user.display_name,
        'color': user.color
    })

# API Routes - Projects
@app.route('/api/projects', methods=['GET', 'POST'])
def handle_projects():
    if request.method == 'POST':
        data = request.json
        project = Project(
            name=data['name'],
            description=data.get('description', ''),
            status=data.get('status', 'active'),
            created_by=data['created_by']
        )
        db.session.add(project)
        db.session.commit()
        
        fire_event('taskmaster_project_created', {
            'project_id': project.id,
            'project_name': project.name,
            'status': project.status
        })
        
        return jsonify({
            'id': project.id,
            'name': project.name,
            'description': project.description,
            'status': project.status,
            'created_by': project.created_by,
            'created_at': project.created_at.isoformat()
        }), 201
    
    projects = Project.query.all()
    return jsonify([{
        'id': p.id,
        'name': p.name,
        'description': p.description,
        'status': p.status,
        'created_by': p.created_by,
        'created_at': p.created_at.isoformat(),
        'task_count': Task.query.filter_by(project_id=p.id).count(),
        'task_stats': {
            'starting': Task.query.filter_by(project_id=p.id, status='starting').count(),
            'in_progress': Task.query.filter_by(project_id=p.id, status='in_progress').count(),
            'ongoing': Task.query.filter_by(project_id=p.id, status='ongoing').count(),
            'done': Task.query.filter_by(project_id=p.id, status='done').count()
        }
    } for p in projects])
@app.route('/api/projects/<int:project_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_project(project_id):
    project = Project.query.get_or_404(project_id)
    
    if request.method == 'DELETE':
        tasks = Task.query.filter_by(project_id=project_id).all()
        for task in tasks:
            Note.query.filter_by(task_id=task.id).delete()
            TaskImage.query.filter_by(task_id=task.id).delete()
            TaskAssignment.query.filter_by(task_id=task.id).delete()
        Task.query.filter_by(project_id=project_id).delete()
        db.session.delete(project)
        db.session.commit()
        return '', 204
    
    if request.method == 'PUT':
        data = request.json
        old_status = project.status
        
        project.name = data.get('name', project.name)
        project.description = data.get('description', project.description)
        project.status = data.get('status', project.status)
        db.session.commit()
        
        if old_status != project.status:
            fire_event('taskmaster_project_status_changed', {
                'project_id': project.id,
                'project_name': project.name,
                'old_status': old_status,
                'new_status': project.status
            })
    
    return jsonify({
        'id': project.id,
        'name': project.name,
        'description': project.description,
        'status': project.status,
        'created_by': project.created_by,
        'created_at': project.created_at.isoformat()
    })

# API Routes - Tasks
@app.route('/api/projects/<int:project_id>/tasks', methods=['GET', 'POST'])
def handle_tasks(project_id):
    if request.method == 'POST':
        data = request.json
        
        # Set started_at if status is in_progress or ongoing
        started_at = None
        if data.get('status') in ['in_progress', 'ongoing']:
            started_at = datetime.utcnow()
        
        task = Task(
            project_id=project_id,
            title=data['title'],
            description=data.get('description', ''),
            status=data.get('status', 'starting'),
            assigned_to=data.get('assigned_to'),
            created_by=data['created_by'],
            priority=data.get('priority', 'medium'),
            started_at=started_at,
            estimated_completion=data.get('estimated_completion')
        )
        
        # Parse estimated_completion if provided as string
        if data.get('estimated_completion'):
            try:
                task.estimated_completion = datetime.fromisoformat(data['estimated_completion'].replace('Z', '+00:00'))
            except:
                pass
        
        db.session.add(task)
        db.session.commit()
        
        # Send notification if task is assigned
        if task.assigned_to:
            assignee = User.query.get(task.assigned_to)
            notify_home_assistant(
                f"You have been assigned a new task: {task.title}",
                f"Task Assignment - {assignee.display_name}"
            )
        
        # Fire event
        fire_event('taskmaster_task_created', {
            'task_id': task.id,
            'project_id': project_id,
            'title': task.title,
            'status': task.status,
            'assigned_to': task.assigned_to
        })
        
        # Update statistics sensor
        update_task_stats()
        
        return jsonify(serialize_task(task)), 201
    
    tasks = Task.query.filter_by(project_id=project_id).all()
    return jsonify([serialize_task(t) for t in tasks])

@app.route('/api/tasks/<int:task_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_task(task_id):
    task = Task.query.get_or_404(task_id)
    
    if request.method == 'DELETE':
        Note.query.filter_by(task_id=task_id).delete()
        db.session.delete(task)
        db.session.commit()
        update_task_stats()
        return '', 204
    
    if request.method == 'PUT':
        data = request.json
        old_status = task.status
        old_assignee = task.assigned_to
        
        task.title = data.get('title', task.title)
        task.description = data.get('description', task.description)
        task.status = data.get('status', task.status)
        task.assigned_to = data.get('assigned_to', task.assigned_to)
        task.priority = data.get('priority', task.priority)
        
        # Update estimated_completion if provided
        if 'estimated_completion' in data:
            if data['estimated_completion']:
                try:
                    task.estimated_completion = datetime.fromisoformat(data['estimated_completion'].replace('Z', '+00:00'))
                except:
                    pass
            else:
                task.estimated_completion = None
        
        # Track when work starts
        if old_status == 'starting' and task.status in ['in_progress', 'ongoing'] and not task.started_at:
            task.started_at = datetime.utcnow()
        
        # Track when task is completed
        if old_status != 'done' and task.status == 'done':
            task.completed_at = datetime.utcnow()
        
        # Clear completion time if moved back from done
        if old_status == 'done' and task.status != 'done':
            task.completed_at = None
        
        db.session.commit()
        
        # Fire event if status changed
        if old_status != task.status:
            fire_event('taskmaster_task_status_changed', {
                'task_id': task.id,
                'title': task.title,
                'old_status': old_status,
                'new_status': task.status
            })
            
            if task.status == 'done':
                notify_home_assistant(f"Task completed: {task.title}", "Task Done!")
        
        # Notify if reassigned
        if old_assignee != task.assigned_to and task.assigned_to:
            assignee = User.query.get(task.assigned_to)
            notify_home_assistant(
                f"Task reassigned to you: {task.title}",
                f"Task Assignment - {assignee.display_name}"
            )
        
        update_task_stats()
    
    return jsonify(serialize_task(task))

# API Routes - Notes
@app.route('/api/tasks/<int:task_id>/notes', methods=['GET', 'POST'])
def handle_notes(task_id):
    if request.method == 'POST':
        data = request.json
        note = Note(
            task_id=task_id,
            user_id=data['user_id'],
            content=data['content']
        )
        db.session.add(note)
        db.session.commit()
        
        fire_event('taskmaster_note_added', {
            'task_id': task_id,
            'note_id': note.id,
            'user_id': note.user_id
        })
        
        return jsonify(serialize_note(note)), 201
    
    notes = Note.query.filter_by(task_id=task_id).order_by(Note.created_at.desc()).all()
    return jsonify([serialize_note(n) for n in notes])

@app.route('/api/notes/<int:note_id>', methods=['PUT', 'DELETE'])
def handle_note(note_id):
    note = Note.query.get_or_404(note_id)
    
    if request.method == 'DELETE':
        db.session.delete(note)
        db.session.commit()
        return '', 204
    
    if request.method == 'PUT':
        data = request.json
        note.content = data.get('content', note.content)
        db.session.commit()
    
    return jsonify(serialize_note(note))

# API Routes - Task Images
@app.route('/api/tasks/<int:task_id>/images', methods=['GET', 'POST'])
def handle_task_images(task_id):
    task = Task.query.get_or_404(task_id)
    
    if request.method == 'POST':
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        user_id = request.form.get('user_id')
        
        if not user_id:
            return jsonify({'error': 'user_id required'}), 400
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if file and allowed_file(file.filename):
            # Generate unique filename
            original_filename = secure_filename(file.filename)
            file_extension = original_filename.rsplit('.', 1)[1].lower()
            unique_filename = f"{uuid.uuid4().hex}.{file_extension}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            
            # Save file
            file.save(file_path)
            
            # Get file size
            file_size = os.path.getsize(file_path)
            
            # Determine mime type
            mime_types = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'bmp': 'image/bmp'
            }
            mime_type = mime_types.get(file_extension, 'application/octet-stream')
            
            # Create database entry
            task_image = TaskImage(
                task_id=task_id,
                user_id=int(user_id),
                filename=unique_filename,
                original_filename=original_filename,
                file_path=file_path,
                mime_type=mime_type,
                file_size=file_size
            )
            db.session.add(task_image)
            db.session.commit()
            
            # Fire event
            fire_event('taskmaster_image_uploaded', {
                'task_id': task_id,
                'image_id': task_image.id,
                'user_id': task_image.user_id,
                'filename': original_filename
            })
            
            return jsonify(serialize_task_image(task_image)), 201
        
        return jsonify({'error': 'Invalid file type'}), 400
    
    # GET - Return all images for task
    images = TaskImage.query.filter_by(task_id=task_id).order_by(TaskImage.created_at.desc()).all()
    return jsonify([serialize_task_image(img) for img in images])

@app.route('/api/images/<int:image_id>', methods=['DELETE'])
def handle_task_image(image_id):
    image = TaskImage.query.get_or_404(image_id)
    
    # Delete file from filesystem
    try:
        if os.path.exists(image.file_path):
            os.remove(image.file_path)
    except Exception as e:
        print(f"Error deleting file: {e}")
    
    # Delete database entry
    db.session.delete(image)
    db.session.commit()
    
    return '', 204

@app.route('/api/images/<int:image_id>/download', methods=['GET'])
def download_task_image(image_id):
    image = TaskImage.query.get_or_404(image_id)
    
    if not os.path.exists(image.file_path):
        return jsonify({'error': 'File not found'}), 404
    
    return send_file(
        image.file_path,
        mimetype=image.mime_type,
        as_attachment=False,
        download_name=image.original_filename
    )

# Statistics and Dashboard
@app.route('/api/stats', methods=['GET'])
def get_stats():
    total_tasks = Task.query.count()
    tasks_by_status = db.session.query(
        Task.status, db.func.count(Task.id)
    ).group_by(Task.status).all()
    
    stats = {
        'total_tasks': total_tasks,
        'total_projects': Project.query.count(),
        'total_users': User.query.count(),
        'by_status': {status: count for status, count in tasks_by_status},
        'recent_activity': []
    }
    
    # Get recent tasks
    recent_tasks = Task.query.order_by(Task.updated_at.desc()).limit(5).all()
    stats['recent_activity'] = [serialize_task(t) for t in recent_tasks]
    
    return jsonify(stats)

# Helper serializers
def serialize_task(task):
    creator = User.query.get(task.created_by)
    assignee = User.query.get(task.assigned_to) if task.assigned_to else None
    
    # Get all assignments
    assignments = TaskAssignment.query.filter_by(task_id=task.id).all()
    assignees = []
    for assignment in assignments:
        user = User.query.get(assignment.user_id)
        if user:
            assignees.append({
                'id': assignment.id,
                'user_id': user.id,
                'username': user.display_name,
                'color': user.color
            })
    
    # Get tags
    task_tag_relations = TaskTag.query.filter_by(task_id=task.id).all()
    tags = []
    for relation in task_tag_relations:
        tag = Tag.query.get(relation.tag_id)
        if tag:
            tags.append({
                'id': tag.id,
                'name': tag.name,
                'color': tag.color
            })
    
    # Get subtask stats
    subtasks = Subtask.query.filter_by(task_id=task.id).all()
    completed_subtasks = sum(1 for s in subtasks if s.completed)
    
    return {
        'id': task.id,
        'project_id': task.project_id,
        'title': task.title,
        'description': task.description,
        'status': task.status,
        'priority': task.priority,
        'assigned_to': task.assigned_to,
        'assignee_name': assignee.display_name if assignee else None,
        'assignee_color': assignee.color if assignee else None,
        'assignees': assignees,
        'tags': tags,
        'subtask_count': len(subtasks),
        'completed_subtasks': completed_subtasks,
        'created_by': task.created_by,
        'creator_name': creator.display_name if creator else 'Unknown',
        'created_at': task.created_at.isoformat(),
        'updated_at': task.updated_at.isoformat(),
        'started_at': task.started_at.isoformat() if task.started_at else None,
        'estimated_completion': task.estimated_completion.isoformat() if task.estimated_completion else None,
        'completed_at': task.completed_at.isoformat() if task.completed_at else None,
        'note_count': Note.query.filter_by(task_id=task.id).count(),
        'image_count': TaskImage.query.filter_by(task_id=task.id).count()
    }
def serialize_note(note):
    user = User.query.get(note.user_id)
    return {
        'id': note.id,
        'task_id': note.task_id,
        'user_id': note.user_id,
        'username': user.display_name if user else 'Unknown',
        'user_color': user.color if user else '#3498db',
        'content': note.content,
        'created_at': note.created_at.isoformat(),
        'updated_at': note.updated_at.isoformat()
    }

def serialize_task_image(image):
    user = User.query.get(image.user_id)
    return {
        'id': image.id,
        'task_id': image.task_id,
        'user_id': image.user_id,
        'username': user.display_name if user else 'Unknown',
        'user_color': user.color if user else '#3498db',
        'filename': image.filename,
        'original_filename': image.original_filename,
        'mime_type': image.mime_type,
        'file_size': image.file_size,
        'url': f'/api/images/{image.id}/download',
        'created_at': image.created_at.isoformat()
    }

def serialize_assignment(assignment):
    user = User.query.get(assignment.user_id)
    assigned_by_user = User.query.get(assignment.assigned_by) if assignment.assigned_by else None
    
    return {
        'id': assignment.id,
        'task_id': assignment.task_id,
        'user_id': assignment.user_id,
        'username': user.display_name if user else 'Unknown',
        'user_color': user.color if user else '#3498db',
        'assigned_at': assignment.assigned_at.isoformat(),
        'assigned_by': assignment.assigned_by,
        'assigned_by_name': assigned_by_user.display_name if assigned_by_user else 'Unknown'
    }

def update_task_stats():
    """Update Home Assistant sensors with task statistics"""
    stats = {
        'starting': Task.query.filter_by(status='starting').count(),
        'in_progress': Task.query.filter_by(status='in_progress').count(),
        'ongoing': Task.query.filter_by(status='ongoing').count(),
        'done': Task.query.filter_by(status='done').count()
    }
    
    total = sum(stats.values())
    
    update_sensor('sensor.taskmaster_total_tasks', total, stats)
    update_sensor('sensor.taskmaster_done_tasks', stats['done'], {})
    update_sensor('sensor.taskmaster_active_tasks', total - stats['done'], {})

# API Routes - Tags
@app.route('/api/tags', methods=['GET', 'POST'])
def handle_tags():
    """Get all tags or create a new tag"""
    if request.method == 'POST':
        data = request.json
        
        if not data.get('name'):
            return jsonify({'error': 'Tag name is required'}), 400
        
        if not data.get('created_by'):
            return jsonify({'error': 'created_by is required'}), 400
        
        # Check if tag already exists for this project (or globally)
        project_id = data.get('project_id')
        existing = Tag.query.filter_by(name=data['name'], project_id=project_id).first()
        
        if existing:
            return jsonify({'error': 'Tag with this name already exists'}), 400
        
        tag = Tag(
            name=data['name'],
            color=data.get('color', '#3498db'),
            project_id=project_id,
            created_by=data['created_by']
        )
        
        db.session.add(tag)
        db.session.commit()
        
        log_activity(
            data['created_by'],
            'created',
            'tag',
            tag.id,
            f"Created tag: {tag.name}"
        )
        
        return jsonify({
            'id': tag.id,
            'name': tag.name,
            'color': tag.color,
            'project_id': tag.project_id,
            'created_by': tag.created_by
        }), 201
    
    # GET - Return all tags (optionally filtered by project)
    project_id = request.args.get('project_id', type=int)
    
    if project_id:
        # Get project-specific tags + global tags
        tags = Tag.query.filter(
            (Tag.project_id == project_id) | (Tag.project_id == None)
        ).all()
    else:
        # Get all tags
        tags = Tag.query.all()
    
    return jsonify([{
        'id': t.id,
        'name': t.name,
        'color': t.color,
        'project_id': t.project_id,
        'is_global': t.project_id is None,
        'created_by': t.created_by
    } for t in tags])

@app.route('/api/tags/<int:tag_id>', methods=['GET', 'DELETE'])
def handle_tag(tag_id):
    """Get or delete a specific tag"""
    tag = Tag.query.get_or_404(tag_id)
    
    if request.method == 'DELETE':
        # TaskTag relationships will be auto-deleted due to cascade
        tag_name = tag.name
        db.session.delete(tag)
        db.session.commit()
        
        log_activity(
            None,
            'deleted',
            'tag',
            tag_id,
            f"Deleted tag: {tag_name}"
        )
        
        return '', 204
    
    return jsonify({
        'id': tag.id,
        'name': tag.name,
        'color': tag.color,
        'project_id': tag.project_id,
        'is_global': tag.project_id is None
    })

@app.route('/api/tasks/<int:task_id>/tags', methods=['POST', 'DELETE'])
def handle_task_tags(task_id):
    """Add or remove tags from a task"""
    task = Task.query.get_or_404(task_id)
    
    if request.method == 'POST':
        data = request.json
        tag_id = data.get('tag_id')
        
        if not tag_id:
            return jsonify({'error': 'tag_id is required'}), 400
        
        tag = Tag.query.get_or_404(tag_id)
        
        # Check if already tagged
        existing = TaskTag.query.filter_by(task_id=task_id, tag_id=tag_id).first()
        if existing:
            return jsonify({'error': 'Task already has this tag'}), 400
        
        task_tag = TaskTag(task_id=task_id, tag_id=tag_id)
        db.session.add(task_tag)
        db.session.commit()
        
        log_activity(
            None,
            'tagged',
            'task',
            task_id,
            f"Added tag '{tag.name}' to task"
        )
        
        return jsonify({
            'id': task_tag.id,
            'task_id': task_id,
            'tag_id': tag_id,
            'tag_name': tag.name,
            'tag_color': tag.color
        }), 201
    
    if request.method == 'DELETE':
        tag_id = request.args.get('tag_id', type=int)
        
        if not tag_id:
            return jsonify({'error': 'tag_id is required'}), 400
        
        task_tag = TaskTag.query.filter_by(task_id=task_id, tag_id=tag_id).first()
        
        if not task_tag:
            return jsonify({'error': 'Tag not found on this task'}), 404
        
        db.session.delete(task_tag)
        db.session.commit()
        
        return '', 204

# Serve frontend
@app.route('/')
def index():
    return send_from_directory('web', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('web', path)

# API Routes - Task Assignments (Multiple Assignees)
@app.route('/api/tasks/<int:task_id>/assignments', methods=['GET', 'POST'])
def handle_task_assignments(task_id):
    task = Task.query.get_or_404(task_id)
    
    if request.method == 'POST':
        data = request.json
        user_id = data['user_id']
        assigned_by = data.get('assigned_by')  # Fixed - removed undefined variable
        
        # Check if already assigned
        existing = TaskAssignment.query.filter_by(task_id=task_id, user_id=user_id).first()
        if existing:
            return jsonify({'error': 'User already assigned to this task'}), 400
        
        assignment = TaskAssignment(
            task_id=task_id,
            user_id=user_id,
            assigned_by=assigned_by
        )
        db.session.add(assignment)
        db.session.commit()
        
        user = User.query.get(user_id)
        fire_event('taskmaster_user_assigned', {
            'task_id': task_id,
            'user_id': user_id,
            'username': user.display_name if user else 'Unknown'
        })
        
        notify_home_assistant(
            f"You have been assigned to task: {task.title}",
            f"Task Assignment - {user.display_name if user else 'User'}"
        )
        
        return jsonify(serialize_assignment(assignment)), 201
    
    # GET - Return all assignments
    assignments = TaskAssignment.query.filter_by(task_id=task_id).all()
    return jsonify([serialize_assignment(a) for a in assignments])

@app.route('/api/assignments/<int:assignment_id>', methods=['DELETE'])
def handle_task_assignment(assignment_id):
    assignment = TaskAssignment.query.get_or_404(assignment_id)
    task_id = assignment.task_id
    
    db.session.delete(assignment)
    db.session.commit()
    
    fire_event('taskmaster_user_unassigned', {
        'task_id': task_id,
        'user_id': assignment.user_id
    })
    
    return '', 204

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8099, debug=False)
