from os import environ
from flask_cors import CORS
import sys

# Add the correct path to the system path
sys.path.append('backend/grpproj')

# Import the app from the grpproj module
from grpproj import app

# Enable CORS for the entire app
CORS(app)

# The entry point for Gunicorn to run the Flask app
if __name__ == '__main__':
    # Make sure it's accessible externally on the given PORT (Azure's environment)
    HOST = environ.get('SERVER_HOST', '0.0.0.0')  # Bind to all available network interfaces
    PORT = int(environ.get('PORT', 8000))  # Azure uses the PORT environment variable

    # No need to run `app.run()`, as Gunicorn will take care of the app serving.
    # Instead, just ensure the app is correctly exposed for Gunicorn.

