@echo off
rem Sift — start the server (survives reboots via Task Scheduler, see README)
cd /d "%~dp0backend"
"%~dp0venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
