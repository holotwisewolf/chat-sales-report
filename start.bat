@echo off
rem Double-click starter: installs dependencies on first run, starts the dashboard, opens the browser.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run - installing. This takes a few minutes, once only.
  call npm install
)
if not exist .env (
  echo No .env file found. Creating one - add your GEMINI_API_KEY in it, then run this file again.
  (
    echo GEMINI_API_KEY=
    echo BUSINESS_NAME=
  ) > .env
  notepad .env
)
rem Give the server a moment, then open the browser.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
echo Starting the sales dashboard...
call npm start
pause
