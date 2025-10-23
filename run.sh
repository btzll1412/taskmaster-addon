#!/usr/bin/with-contenv bashio

bashio::log.info "Starting TaskMaster..."

# Get configuration
SSL=$(bashio::config 'ssl')

# Start application
cd /app
python3 app.py
