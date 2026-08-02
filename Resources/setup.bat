@echo off
title Project Setup Installer
echo ==========================================
echo        Automated Environment Setup
echo ==========================================
echo.


:: Check if Python is installed
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not added to PATH.
    pause
    exit /b
)


:: Check if Node.js is installed
node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not added to PATH.
    echo Please install Node.js from nodejs.org and try again.
    pause
    exit /b
)

echo [1/3] Creating Python Virtual Environment...
IF NOT EXIST "Lawyer\" (
    python -m venv Lawyer
    echo Virtual environment created successfully.
) ELSE (
    echo Virtual environment already exists. Skipping...
)

echo.
echo [2/3] Installing Python Dependencies...
call venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r dependencies.txt

echo.
echo [3/3] Installing Node.js Dependencies...
cd legal-frontend
npm install

echo.
echo ===================================================
echo     Setup Complete! 
echo ===================================================
echo.
echo To start the Python backend, run:
echo    call venv\Scripts\activate
echo    uvicorn main:app --reload
echo.
echo To start the React frontend, run:
echo    npm run dev
echo.
pause