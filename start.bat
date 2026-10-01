@echo off
rem Starts the Flashcards app: runs the local server and opens the app in Microsoft Edge.
rem The server keeps running in a minimised window; close that window to stop it.

cd /d "%~dp0"

set "PYTHON="
py -3 -c "import http.server" >nul 2>nul
if not errorlevel 1 set "PYTHON=py -3"
if not defined PYTHON (
  python -c "import http.server" >nul 2>nul
  if not errorlevel 1 set "PYTHON=python"
)
if not defined PYTHON (
  echo Python 3 was not found on this computer.
  echo Install it from https://www.python.org/downloads/ and run this file again.
  pause
  exit /b 1
)

start "Flashcards server" /min %PYTHON% serve.py --open
