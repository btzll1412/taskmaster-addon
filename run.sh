#!/bin/sh
set -e

echo "Starting TaskMaster v3..."
cd /app

# Single worker (in-process SSE event bus), many threads for concurrent
# requests and long-lived event streams.
exec gunicorn \
    --bind "0.0.0.0:${PORT:-8099}" \
    --workers 1 \
    --threads 32 \
    --timeout 0 \
    --access-logfile - \
    app:app
