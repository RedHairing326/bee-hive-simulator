@echo off
echo ========================================
echo    Bee Hive Simulator Launcher
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo.
    echo Please install Python from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo [OK] Python found!
echo.

REM Kill any existing Python HTTP servers on port 8000
echo [INFO] Checking for existing servers on port 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    echo [INFO] Killing existing server process %%a
    taskkill /F /PID %%a >nul 2>&1
)
echo.

REM Get the directory where this batch file is located
set "PROJECT_DIR=%~dp0"

REM Remove trailing backslash if present
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo [INFO] Project directory: %PROJECT_DIR%
echo.

REM Verify we're in the right place by checking for index.html
if not exist "%PROJECT_DIR%\index.html" (
    echo [ERROR] Cannot find index.html in: %PROJECT_DIR%
    echo [ERROR] Make sure launch.bat is in the same folder as index.html
    echo.
    pause
    exit /b 1
)

echo [OK] Found index.html
echo.

REM Get local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do set "LOCAL_IP=%%a"
set "LOCAL_IP=%LOCAL_IP:~1%"

echo [INFO] Starting web server (NETWORK ACCESSIBLE)...
echo.
echo ========================================
echo   Access URLs:
echo ========================================
echo   Local:   http://localhost:8000
echo   Network: http://%LOCAL_IP%:8000
echo ========================================
echo.
echo [TIP] Share the Network URL with others on your WiFi/LAN!
echo [TIP] For internet access, see: ngrok.com or use port forwarding
echo.
echo [IMPORTANT] Do NOT close this window while using the simulator!
echo             Press Ctrl+C to stop the server when done.
echo.
echo ========================================
echo.

REM Wait a moment before opening browser
timeout /t 2 /nobreak >nul

REM Open browser in background
start http://localhost:8000

REM Change to project directory and start Python HTTP server with 0.0.0.0 binding
cd /d "%PROJECT_DIR%"
python -m http.server 8000 --bind 0.0.0.0 --directory "%PROJECT_DIR%"

