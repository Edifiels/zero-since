@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запуск презентации...
where node >nul 2>nul
if %errorlevel%==0 (
  node tools\serve.mjs 8000 --open
  pause
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8000/"
  py -c "import http.server, mimetypes; mimetypes.add_type('text/javascript', '.js'); mimetypes.add_type('text/css', '.css'); http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8000, bind='127.0.0.1')"
  pause
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8000/"
  python -c "import http.server, mimetypes; mimetypes.add_type('text/javascript', '.js'); mimetypes.add_type('text/css', '.css'); http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8000, bind='127.0.0.1')"
  pause
  goto :eof
)
echo Не найден ни Node.js, ни Python. Установите один из них или откройте онлайн-версию на GitHub Pages.
pause
