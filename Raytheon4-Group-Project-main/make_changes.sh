#!/bin/bash

gnome-terminal -- bash -c "echo 'Running command '; cd frontend && npm run build && cd .. && cd backend/grpproj && python3 runserver.py; exec bash"
#gnome-terminal -- bash -c "echo 'Terminal 2: Running command 2'; cd backend/grpproj && python3 runserver.py; exec bash"

