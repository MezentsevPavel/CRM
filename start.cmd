@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Запуск CRM. Если директор нажал «Обновить» в Настройках, сервер ставит новую версию и выходит с кодом 75 — тогда здесь он запускается снова.
set CRM_SUPERVISED=1
:loop
node server/main.js
if %errorlevel%==75 (
  echo.
  echo Обновление установлено, запускаю CRM заново...
  echo.
  goto loop
)
echo.
echo CRM остановлена.
pause
