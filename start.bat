@echo off
setlocal EnableDelayedExpansion
rem Double-click starter: checks for updates, installs dependencies, starts dashboard, and opens browser when hosted.
cd /d "%~dp0"

echo ===================================================
echo               Sales Dashboard
echo ===================================================

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js is not installed.
  echo Please install the LTS version from https://nodejs.org, then run this file again.
  echo.
  pause
  exit /b 1
)

where git >nul 2>nul
if not errorlevel 1 (
  if exist ".git" (
    echo Checking for updates...
    git fetch origin --quiet 2>nul
    for /f "tokens=*" %%i in ('git rev-parse HEAD 2^>nul') do set "CURRENT_REV=%%i"
    for /f "tokens=*" %%i in ('git rev-parse @{u} 2^>nul') do set "REMOTE_REV=%%i"
    if not defined REMOTE_REV (
      for /f "tokens=*" %%i in ('git rev-parse origin/main 2^>nul') do set "REMOTE_REV=%%i"
    )
    
    if defined CURRENT_REV if defined REMOTE_REV (
      if not "!CURRENT_REV!"=="!REMOTE_REV!" (
        echo New update found! Updating codebase, please wait...
        git pull --ff-only
        echo Updating dependencies, please wait...
        if exist package.json call npm install --quiet
        echo Update completed successfully.
        echo Restarting sales dashboard...
        timeout /t 1 /nobreak >nul
        start "" cmd /c "call \"%~f0\""
        exit /b 0
      )
    )
  )
)

if not exist node_modules (
  echo First run: Installing dependencies, please wait... (this only takes a moment)
  call npm install
  if errorlevel 1 (
    echo [Error] Failed to install npm dependencies.
    pause
    exit /b 1
  )
)

if not exist .env (
  echo No .env file found. Creating one - add your GEMINI_API_KEY in it, then run this file again.
  (
    echo GEMINI_API_KEY=
    echo BUSINESS_NAME=
  ) > .env
  notepad .env
)

echo.
echo Starting the sales dashboard, please wait...
echo.
call npm start
if errorlevel 1 (
  echo.
  echo [Error] Dashboard stopped or failed to start.
  pause
)