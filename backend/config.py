import os

# Where the SQLite database and uploads live. /data on Home Assistant,
# override with DATA_DIR for standalone / development runs.
DATA_DIR = os.environ.get('DATA_DIR', '/data')
UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')

# Built frontend bundle
WEB_DIST = os.environ.get(
    'WEB_DIST',
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web', 'dist'),
)

ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
    'pdf', 'txt', 'md', 'csv', 'xlsx', 'docx', 'pptx', 'zip',
}

PORT = int(os.environ.get('PORT', '8099'))
