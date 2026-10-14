#!/usr/bin/env sh
# Запуск презентации локально: ./start-local.sh  → браузер откроется сам
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  exec node tools/serve.mjs 8000 --open
elif command -v python3 >/dev/null 2>&1; then
  (sleep 1.5; (xdg-open http://localhost:8000/ || open http://localhost:8000/) >/dev/null 2>&1) &
  exec python3 -c "import http.server, mimetypes; mimetypes.add_type('text/javascript', '.js'); http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8000, bind='127.0.0.1')"
else
  echo "Нужен Node.js или Python 3"
fi
