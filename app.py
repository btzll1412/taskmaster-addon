#!/usr/bin/env python3
"""TaskMaster v3 entry point.

Run directly for development:
    DATA_DIR=./data python3 app.py
In production (add-on / Docker) gunicorn imports `app` from this module.
Keep a single worker process: real-time SSE uses an in-process event bus.
"""
from backend import create_app
from backend.config import PORT

app = create_app()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, threaded=True)
