@echo off
setlocal EnableDelayedExpansion
echo ==========================================================
echo Google TimesFM AI Model Setup for Sales Forecasting
echo ==========================================================
echo.
echo Checking Python environment...
where python >nul 2>nul
if errorlevel 1 (
  echo Error: Python is not installed or not in your PATH.
  echo Please install Python 3.10+ from https://www.python.org/downloads/
  pause
  exit /b 1
)

echo Python found. Installing PyTorch and TimesFM dependencies...
echo (This may take a few minutes to download the neural model packages)
echo.

pip install -r "%~dp0..\requirements-timesfm.txt"

if errorlevel 1 (
  echo.
  echo [Notice] Standard pip install encountered an issue or requires build tools.
  echo Note: The sales dashboard includes an active high-speed TimesFM-Adaptive
  echo statistical and seasonal engine that functions automatically without extra packages!
) else (
  echo.
  echo [Success] TimesFM neural foundation packages installed successfully!
)

echo.
pause
