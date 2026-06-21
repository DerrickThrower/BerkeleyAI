#!/usr/bin/env bash
# One-command demo bring-up for VibeDocs AI.
set -e
cd "$(dirname "$0")"

echo "▶ starting Redis + Phoenix (docker)…"
docker compose up -d

echo "▶ installing deps (first run only)…"
( cd server && npm install --silent )
( cd web && npm install --silent )

echo "▶ seeding demo room…"
( cd server && npm run seed )

echo "▶ starting API server (:8787) and web (:5173)…"
( cd server && npm run dev > /tmp/vibedocs-server.log 2>&1 & )
( cd web && npm run dev > /tmp/vibedocs-web.log 2>&1 & )
sleep 4

cat <<'EOF'

✅ VibeDocs AI is up.

   Open TWO browser windows (two laptops for the real demo):
     Maria → http://localhost:5173/?name=Maria&model=claude&room=demo
     Sam   → http://localhost:5173/?name=Sam&model=gpt&room=demo

   Phoenix traces → http://localhost:6006   (project: vibedocs-ai)

   Logs: /tmp/vibedocs-server.log  ·  /tmp/vibedocs-web.log
   Validate core:  cd server && npm run smoke
EOF
