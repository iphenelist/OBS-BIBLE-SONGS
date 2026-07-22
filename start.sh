#!/usr/bin/env bash
# Double-click launcher: starts the server and opens the control panel in your browser.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org and try again."
  read -rp "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)..."
  npm install
fi

node server.js &
SERVER_PID=$!

sleep 1

URL="http://localhost:3000/control.html"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 &
else
  echo "Open this URL in your browser: $URL"
fi

echo "Server running. Overlay: http://localhost:3000/overlay.html"
echo "Close this window (or press Ctrl+C) to stop the server."

wait $SERVER_PID
