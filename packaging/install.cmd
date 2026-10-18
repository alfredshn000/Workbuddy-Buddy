@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

rem Buddy 便携安装：复制到 %LOCALAPPDATA%\Programs\Buddy，建开始菜单快捷方式，然后启动
rem 和 CrossPet 一样：不需要管理员权限，不改注册表（除开机自启外），删目录即卸载干净

set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\Programs\Buddy"

echo.
echo   Buddy - 安装到 %DEST%
echo.

if not exist "%DEST%" mkdir "%DEST%"

rem 关掉正在运行的实例，避免覆盖失败
taskkill /f /im Buddy.exe >nul 2>nul
taskkill /f /im workbuddy-buddy.exe >nul 2>nul
timeout /t 1 >nul

for %%F in ("%SRC%Buddy.exe" "%SRC%workbuddy-buddy.exe") do (
  if exist "%%~fF" (
    copy /y "%%~fF" "%DEST%\Buddy.exe" >nul
    goto :copied
  )
)
echo   [x] 没找到 Buddy.exe，请确认解压完整
pause
exit /b 1

:copied
if exist "%SRC%buddy.ico" copy /y "%SRC%buddy.ico" "%DEST%\buddy.ico" >nul

rem 开始菜单快捷方式
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Buddy.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%');" ^
  "$s.TargetPath='%DEST%\Buddy.exe';$s.WorkingDirectory='%DEST%';$s.Description='Buddy 桌面助手';$s.Save()" >nul 2>nul

echo   [ok] 已安装
echo   [ok] 开始菜单：Buddy
echo.

start "" "%DEST%\Buddy.exe"
echo   已启动。开机自启可在托盘菜单里勾选。
echo.
timeout /t 3 >nul
