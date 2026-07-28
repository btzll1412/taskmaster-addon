"""In-process pub/sub event bus feeding Server-Sent Events streams.

Runs single-worker (multi-threaded), so a plain in-memory registry is enough.
"""
import json
import queue
import threading

_lock = threading.Lock()
_subscribers = []  # list of (queue.Queue, user_id)


def subscribe(user_id):
    q = queue.Queue(maxsize=200)
    with _lock:
        _subscribers.append((q, user_id))
    return q


def unsubscribe(q):
    with _lock:
        _subscribers[:] = [(sq, uid) for (sq, uid) in _subscribers if sq is not q]


def publish(event, target_user_id=None):
    """Broadcast an event dict. If target_user_id is set, only that user receives it."""
    with _lock:
        subs = list(_subscribers)
    for q, uid in subs:
        if target_user_id is not None and uid != target_user_id:
            continue
        try:
            q.put_nowait(event)
        except queue.Full:
            pass


def sse_stream(q):
    """Generator producing SSE frames; heartbeats keep proxies from closing the stream."""
    yield 'retry: 3000\n\n'
    while True:
        try:
            event = q.get(timeout=25)
            yield f'data: {json.dumps(event)}\n\n'
        except queue.Empty:
            yield ': keepalive\n\n'
