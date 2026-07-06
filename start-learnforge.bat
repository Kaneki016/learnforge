@echo off
cd /d "%~dp0"
start "" http://localhost:3210
node src\server.js
pause
