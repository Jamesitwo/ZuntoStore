@echo off
rem Arranca ZuntoStore en Windows: libera el puerto 8787 si quedo un servidor
rem viejo y abre dos ventanas: el servidor (server) y el panel (panel).
rem Lo que muestra el servidor tambien queda en server\servidor.log.
title ZuntoStore
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8787 ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
start "ZuntoStore - servidor" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%~dp0server'; npm start 2>&1 | Tee-Object -FilePath servidor.log"
rem el panel solo si no esta ya abierto (puertos 5173/5174 de Vite)
netstat -ano | findstr ":5173 :5174" | findstr LISTENING >nul || start "ZuntoStore - panel" cmd /k "cd /d "%~dp0panel" && npm run dev"
