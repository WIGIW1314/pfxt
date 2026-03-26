@echo off
setlocal

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 goto no_git

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 goto no_repo

echo.
echo ==== Git Status ====
git status --short
echo.

set "COMMIT_MSG="
set /p COMMIT_MSG=Enter commit message (default: update): 
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=update"

echo.
echo [1/3] git add -A
git add -A
if errorlevel 1 goto add_failed

echo.
echo [2/3] git commit
git commit -m "%COMMIT_MSG%"
if errorlevel 1 goto commit_failed

echo.
echo [3/3] git push
git push
if errorlevel 1 goto push_failed

echo.
echo [OK] Push completed.
echo.
echo Next on server:
echo   cd /www/wwwroot/pfxt
echo   bash ./deploy.sh
echo Then restart the Node project in BT Panel.
echo.
pause
exit /b 0

:no_git
echo.
echo [ERROR] git was not found in PATH.
pause
exit /b 1

:no_repo
echo.
echo [ERROR] Current folder is not a git repository.
pause
exit /b 1

:add_failed
echo.
echo [ERROR] git add failed.
pause
exit /b 1

:commit_failed
echo.
echo [INFO] git commit failed.
echo [INFO] This usually means there is nothing to commit.
pause
exit /b 1

:push_failed
echo.
echo [ERROR] git push failed.
pause
exit /b 1
