import os
import subprocess
import shutil
import sys
import time

# === Paths ===
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
BACKEND_DIR = os.path.join(BASE_DIR, "backend", "grpproj")
# Update STATIC_DIR to reflect your Flask static folder
STATIC_DIR = os.path.join(BACKEND_DIR, "grpproj", "grpproj", "static")
RUNSERVER_PATH = os.path.join(BACKEND_DIR, "runserver.py")
VENV_DIR = os.path.join(BACKEND_DIR, "env")
REQUIREMENTS = os.path.join(BACKEND_DIR, "requirements.txt")
# Update BUILD_DIR to match Rollup output directory (relative to FRONTEND_DIR)
BUILD_DIR = os.path.join(FRONTEND_DIR, "..", "backend", "grpproj", "grpproj", "static")
NPM_CMD = "npm.cmd" if sys.platform == "win32" else "npm"

# === VENV Executable ===
if sys.platform == "win32":
    python_executable = os.path.join(VENV_DIR, "Scripts", "python.exe")
else:
    python_executable = os.path.join(VENV_DIR, "bin", "python")

if not os.path.exists(python_executable):
    print(f"Virtual environment not found at {python_executable}. Please create one.")
    sys.exit(1)

# === Install Python Dependencies ===
print("Installing backend dependencies from requirements.txt...")
subprocess.run([python_executable, "-m", "pip", "install", "-r", REQUIREMENTS],
               check=True, env=os.environ.copy())

# === Build Svelte Frontend ===
print("Building Svelte frontend...")
subprocess.run([NPM_CMD, "install"], cwd=FRONTEND_DIR, check=True, shell=True, env=os.environ.copy())
subprocess.run([NPM_CMD, "run", "build"], cwd=FRONTEND_DIR, check=True, shell=True, env=os.environ.copy())

# Debug: List contents of BUILD_DIR after build
print("Contents of BUILD_DIR after build:")
print(os.listdir(BUILD_DIR))

# Optional: wait a couple of seconds to ensure files are written
time.sleep(2)

# === (Optional) Copy files if needed ===
# In this case, BUILD_DIR is the same as STATIC_DIR, so copying may be unnecessary.
# If you do need to copy from one folder to another, uncomment the following:
# os.makedirs(STATIC_DIR, exist_ok=True)
# for item in os.listdir(BUILD_DIR):
#     src = os.path.join(BUILD_DIR, item)
#     dst = os.path.join(STATIC_DIR, item)
#     if os.path.isdir(src):
#         shutil.copytree(src, dst, dirs_exist_ok=True)
#     else:
#         shutil.copy2(src, dst)
# print("Frontend deployed to static/")

# === Start Flask App Using Virtual Environment ===
print("Starting Flask backend...")

if sys.platform == "win32":
    activate_script = os.path.join(VENV_DIR, "Scripts", "activate.bat")
    command = f'cmd.exe /c "{activate_script} && python {RUNSERVER_PATH}"'
else:
    activate_script = os.path.join(VENV_DIR, "bin", "activate")
    command = f'bash -c "source {activate_script} && python {RUNSERVER_PATH}"'

flask_process = subprocess.Popen(command, cwd=BACKEND_DIR, shell=True)

try:
    flask_process.wait()
except KeyboardInterrupt:
    print("\nStopping Flask server...")
    flask_process.terminate()
    flask_process.wait()
    print("Flask server stopped.")
