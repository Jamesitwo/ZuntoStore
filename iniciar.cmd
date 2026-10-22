@echo off
rem Arranca ZuntoStore en Windows: libera el puerto 8787 si quedo un servidor
rem viejo y abre dos ventanas: el servidor (server) y el panel (panel).
title ZuntoStore
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8787 ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
start "ZuntoStore - servidor" cmd /k "cd /d "%~dp0server" && npm start"
start "ZuntoStore - panel" cmd /k "cd /d "%~dp0panel" && npm run dev"
