@echo off
setlocal
cd /d "%~dp0"
set "READING_NODE=node"
where node >nul 2>&1
if errorlevel 1 set "READING_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%READING_NODE%" server.mjs
pause
