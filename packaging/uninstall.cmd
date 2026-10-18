@echo off
setlocal
chcp 65001 >nul

rem Buddy 卸载：结束进程、删快捷方式、删安装目录
rem 若勾选过「开机自启」，这里一并清掉注册表项

set "DEST=%LOCALAPPDATA%\Programs\Buddy"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Buddy.lnk"

echo.
echo   Buddy - 卸载
echo.
set /p OK=  确认卸载？(y/N)
if /i not "%OK%"=="y" exit /b 0

taskkill /f /im Buddy.exe >nul 2>nul
taskkill /f /im workbuddy-buddy.exe >nul 2>nul
timeout /t 1 >nul

if exist "%LNK%" del /f /q "%LNK%"
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Buddy" /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "workbuddy-buddy" /f >nul 2>nul

if exist "%DEST%" rmdir /s /q "%DEST%"

echo   [ok] 已卸载
echo.
timeout /t 2 >nul
