@echo off
setlocal
chcp 65001 >nul 2>&1
title DeepSeek Harness Stopper - this window stays open
cd /d "D:\hermes-data\dsh-client-mod\dsh-director-plugin"
set "LOG=D:\hermes-data\dsh-client-mod\dsh-director-plugin\logs\harness-launch.log"
>>"%LOG%" echo [cmd] STOP entered %DATE% %TIME%
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=C:\Users\15142\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
"%NODE_EXE%" "D:\hermes-data\dsh-client-mod\dsh-director-plugin\scripts\stop-harness.mjs" %*
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo [cmd] STOP script exit %RC%
echo.
if "%RC%"=="0" goto ok
echo [WARN] not everything could be cleaned up (exit %RC%).
echo        Try: right-click the tray icon and choose Quit, then run this again.
echo.
pause
exit /b %RC%
:ok
echo [OK] All Harness processes are gone - "Start Harness.cmd" will work now.
echo.
pause >nul
exit /b 0
