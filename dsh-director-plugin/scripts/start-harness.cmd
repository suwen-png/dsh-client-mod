@echo off
setlocal
chcp 65001 >nul 2>&1
title DeepSeek Harness Launcher - this window stays open
cd /d "D:\hermes-data\dsh-client-mod\dsh-director-plugin"
set "LOG=D:\hermes-data\dsh-client-mod\dsh-director-plugin\logs\harness-launch.log"
>>"%LOG%" echo [cmd] entered %DATE% %TIME%
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=C:\Users\15142\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
>>"%LOG%" echo [cmd] node="%NODE_EXE%"
"%NODE_EXE%" "D:\hermes-data\dsh-client-mod\dsh-director-plugin\scripts\start-harness.mjs" %*
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo [cmd] script exit %RC%
echo.
if "%RC%"=="0" goto ok
echo [FAIL] exit code %RC% -- see the messages above.
echo        Log: dsh-director-plugin\logs\harness-launch.log
echo.
echo  NOTES:
echo    * closing the Harness window only HIDES it to the tray (by design).
echo    * a hidden leftover instance makes EVERY later double-click exit
echo      silently and show nothing = what you call 'it flashes and dies'.
echo    * to really quit it: right-click the tray icon and choose Quit,
echo      or just double-click "Stop Harness.cmd" on this Desktop.
echo.
pause
exit /b %RC%
:ok
echo [OK] Harness window is up.
echo.
echo  TIP: closing that window only HIDES it to the tray (by design).
echo       To really quit: right-click the tray icon and choose Quit,
echo       or double-click "Stop Harness.cmd" on this Desktop.
echo       Skip that and the leftover instance will make every later
echo       double-click exit silently (looks like a flash crash).
echo.
pause >nul
exit /b 0
