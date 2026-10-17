@echo off
chcp 65001 >nul
title P02L
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
pause
