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
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('project.id'), nullable=False)
    title = db.Column(db.String(300), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(20), default='starting')  # starting, in_progress, ongoing, done
    assigned_to = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    priority = db.Column(db.String(20), default='medium')  # low, medium, high
    # Date/time tracking
    started_at = db.Column(db.DateTime)  # When work actually started
    estimated_completion = db.Column(db.DateTime)  # Estimated finish time
    completed_at = db.Column(db.DateTime)  # When task was marked done

class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class TaskImage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    filename = db.Column(db.String(500), nullable=False)
    original_filename = db.Column(db.String(500), nullable=False)
    file_path = db.Column(db.String(1000), nullable=False)
    mime_type = db.Column(db.String(100))
    file_size = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# Initialize database
with app.app_context():
    db.create_all()

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
        db.session.delete(user)
        db.session.commit()
        return '', 204
    
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
            created_by=data['created_by']
        )
        db.session.add(project)
        db.session.commit()
        
        fire_event('taskmaster_project_created', {
            'project_id': project.id,
            'project_name': project.name
        })
        
        return jsonify({
            'id': project.id,
            'name': project.name,
            'description': project.description,
            'created_by': project.created_by,
            'created_at': project.created_at.isoformat()
        }), 201
    
    projects = Project.query.all()
    return jsonify([{
        'id': p.id,
        'name': p.name,
        'description': p.description,
        'created_by': p.created_by,
        'created_at': p.created_at.isoformat(),
        'task_count': Task.query.filter_by(project_id=p.id).count()
    } for p in projects])

@app.route('/api/projects/<int:project_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_project(project_id):
    project = Project.query.get_or_404(project_id)
    
    if request.method == 'DELETE':
        tasks = Task.query.filter_by(project_id=project_id).all()
        for task in tasks:
            Note.query.filter_by(task_id=task.id).delete()
            TaskImage.query.filter_by(task_id=task.id).delete()
        Task.query.filter_by(project_id=project_id).delete()
        db.session.delete(project)
        db.session.commit()
        return '', 204
    
    if request.method == 'PUT':
        data = request.json
        project.name = data.get('name', project.name)
        project.description = data.get('description', project.description)
        db.session.commit()
    
    return jsonify({
        'id': project.id,
        'name': project.name,
        'description': project.description,
        'created_by': project.created_by,
        'created_at': project.created_at.isoformat()
    })

# API Routes - Tasks
@app.route('/api/projects/<int:project_id>/tasks', methods=['GET', 'POST'])
def handle_tasks(project_id):
    if request.method == 'POST':
        data = request.json
        
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
        
        if data.get('estimated_completion'):
            try:
                task.estimated_completion = datetime.fromisoformat(data['estimated_completion'].replace('Z', '+00:00'))
            except:
                pass
        
        db.session.add(task)
        db.session.commit()
        
        if task.assigned_to:
            assignee = User.query.get(task.assigned_to)
            notify_home_assistant(
                f"You have been assigned a new task: {task.title}",
                f"Task Assignment - {assignee.display_name}"
            )
        
        fire_event('taskmaster_task_created', {
            'task_id': task.id,
            'project_id': project_id,
            'title': task.title,
            'status': task.status,
            'assigned_to': task.assigned_to
        })
        
        update_task_stats()
        
        return jsonify(serialize_task(task)), 201
    
    tasks = Task.query.filter_by(project_id=project_id).all()
    return jsonify([serialize_task(t) for t in tasks])

@app.route('/api/tasks/<int:task_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_task(task_id):
    task = Task.query.get_or_404(task_id)
    
    if request.method == 'DELETE':
        Note.query.filter_by(task_id=task_id).delete()
        TaskImage.query.filter_by(task_id=task_id).delete()
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
        
        if 'estimated_completion' in data:
            if data['estimated_completion']:
                try:
                    task.estimated_completion = datetime.fromisoformat(data['estimated_completion'].replace('Z', '+00:00'))
                except:
                    pass
            else:
                task.estimated_completion = None
        
        if old_status == 'starting' and task.status in ['in_progress', 'ongoing'] and not task.started_at:
            task.started_at = datetime.utcnow()
        
        if old_status != 'done' and task.status == 'done':
            task.completed_at = datetime.utcnow()
        
        if old_status == 'done' and task.status != 'done':
            task.completed_at = None
        
        db.session.commit()
        
        if old_status != task.status:
            fire_event('taskmaster_task_status_changed', {
                'task_id': task.id,
                'title': task.title,
                'old_status': old_status,
                'new_status': task.status
            })
            
            if task.status == 'done':
                notify_home_assistant(f"Task completed: {task.title}", "Task Done!")
        
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
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        user_id = request.form.get('user_id')
        
        if not user_id:
            return jsonify({'error': 'user_id required'}), 400
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if file and allowed_file(file.filename):
            original_filename = secure_filename(file.filename)
            file_extension = original_filename.rsplit('.', 1)[1].lower()
            unique_filename = f"{uuid.uuid4().hex}.{file_extension}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            
            file.save(file_path)
            file_size = os.path.getsize(file_path)
            
            mime_types = {
                'png': 'image/png',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'gif': 'image/gif',
                'webp': 'image/webp',
                'bmp': 'image/bmp'
            }
            mime_type = mime_types.get(file_extension, 'application/octet-stream')
            
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
            
            fire_event('taskmaster_image_uploaded', {
                'task_id': task_id,
                'image_id': task_image.id,
                'user_id': task_image.user_id,
                'filename': original_filename
            })
            
            return jsonify(serialize_task_image(task_image)), 201
        
        return jsonify({'error': 'Invalid file type'}), 400
    
    images = TaskImage.query.filter_by(task_id=task_id).order_by(TaskImage.created_at.desc()).all()
    return jsonify([serialize_task_image(img) for img in images])

@app.route('/api/images/<int:image_id>', methods=['DELETE'])
def handle_task_image(image_id):
    image = TaskImage.query.get_or_404(image_id)
    
    try:
        if os.path.exists(image.file_path):
            os.remove(image.file_path)
    except Exception as e:
        print(f"Error deleting file: {e}")
    
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
    
    recent_tasks = Task.query.order_by(Task.updated_at.desc()).limit(5).all()
    stats['recent_activity'] = [serialize_task(t) for t in recent_tasks]
    
    return jsonify(stats)

# Helper serializers
def serialize_task(task):
    creator = User.query.get(task.created_by)
    assignee = User.query.get(task.assigned_to) if task.assigned_to else None
    
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

# Serve frontend
@app.route('/')
def index():
    return send_from_directory('web', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('web', path)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8099, debug=False)
