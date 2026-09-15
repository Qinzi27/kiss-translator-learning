@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
where py >nul 2>&1
if errorlevel 1 goto python_fallback
py -3 "%~dp0updater\update.py" %*
set "updater_status=%errorlevel%"
goto finished
:python_fallback
where python >nul 2>&1
if errorlevel 1 goto missing_python
python "%~dp0updater\update.py" %*
set "updater_status=%errorlevel%"
goto finished
:missing_python
echo 需要 Python 3.9 或更高版本，请先安装 Python 3。
echo 说明：同一文件夹中的 UPDATING.md。
set "updater_status=1"
:finished
if "%~1"=="" pause
exit /b %updater_status%
