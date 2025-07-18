from os import environ
from flask_cors import CORS
import sys
sys.path.append('backend/grpproj') 
from grpproj import app

# Enable CORS for the entire app
CORS(app)

if __name__ == '__main__':
    # Use environment variables to get host and port
    HOST = environ.get('SERVER_HOST', '0.0.0.0')  # Make sure it's accessible externally
    PORT = int(environ.get('PORT', 5555))  # Azure uses the PORT environment variable
    
    app.run(host=HOST, port=PORT)

