"""Optional Home Assistant integration via the Supervisor API.

All calls are best-effort no-ops when not running as a Home Assistant add-on.
"""
import os
import threading

import requests

SUPERVISOR_TOKEN = os.environ.get('SUPERVISOR_TOKEN', '')
HA_URL = 'http://supervisor/core/api'


def _headers():
    return {'Authorization': f'Bearer {SUPERVISOR_TOKEN}', 'Content-Type': 'application/json'}


def _post(path, payload):
    if not SUPERVISOR_TOKEN:
        return

    def worker():
        try:
            requests.post(f'{HA_URL}{path}', headers=_headers(), json=payload, timeout=5)
        except Exception as e:
            print(f'HA call failed ({path}): {e}')

    threading.Thread(target=worker, daemon=True).start()


def fire_event(event_type, event_data):
    _post(f'/events/{event_type}', event_data)


def update_sensor(entity_id, state, attributes=None):
    _post(f'/states/{entity_id}', {'state': state, 'attributes': attributes or {}})


def notify(message, title='TaskMaster'):
    _post('/services/persistent_notification/create', {'message': message, 'title': title})
