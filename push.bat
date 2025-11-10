@echo off
echo ========================================
echo   Quick Git Push
echo ========================================
echo.

REM Check if there are any changes
git status --short
if %errorlevel% neq 0 (
    echo [ERROR] Git repository not found!
    pause
    exit /b 1
)

echo.
set /p commit_message="Enter commit message (or press Enter for default): "

if "%commit_message%"=="" (
    set "commit_message=Update simulation"
)

echo.
echo [INFO] Adding all changes...
git add .

echo [INFO] Committing: "%commit_message%"
git commit -m "%commit_message%"

echo [INFO] Pushing to GitHub...
git push

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   SUCCESS! 
    echo   Changes pushed to GitHub
    echo   Site will update in 1-2 minutes at:
    echo   https://redhairing326.github.io/bee-hive-simulator/
    echo ========================================
) else (
    echo.
    echo [ERROR] Push failed! Check your credentials.
)

echo.
pause

