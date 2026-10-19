@echo off
chcp 65001 >nul
title P02L
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js не найден на этом компьютере.
    echo.
    echo P02L теперь работает на Node.js — его нужно установить один раз ^(нужен интернет^),
    echo после этого всё запускается полностью офлайн.
    echo.
    echo Скачать: https://nodejs.org/ ^(кнопка LTS^), установить, затем снова запустить этот файл.
    pause
    exit /b 1
)

node server.js
pause
