#!/usr/bin/env bash
#
# Re-login to BPU or COMO from your Mac (native Chromium, no X11 needed),
# then ship the fresh session state to the Hostinger VPS and restart the bot.
#
# Usage:
#   ./login-and-deploy.sh como   # re-login COMO only
#   ./login-and-deploy.sh bpu    # re-login BPU only
#   ./login-and-deploy.sh both   # re-login both
#
# Prereqs (one-time):
#   - cd bpu-bot && npm install && npx playwright install chromium
#   - .env in this directory with BPU_USERNAME/PASSWORD and/or COMO_USERNAME/PASSWORD
#   - SSH alias "hostinger" configured in ~/.ssh/config

set -euo pipefail

cd "$(dirname "$0")"

TARGET="${1:-}"
case "$TARGET" in
  bpu)  NPM_CMD="login"; STATE_FILES=(.session-state.json) ;;
  como) NPM_CMD="login:como"; STATE_FILES=(.como-session-state.json) ;;
  both) NPM_CMD="login:both"; STATE_FILES=(.session-state.json .como-session-state.json) ;;
  *)    echo "Usage: $0 {bpu|como|both}"; exit 1 ;;
esac

echo "▶ Running npm run $NPM_CMD locally — a Chromium window will open."
echo "  Solve the CAPTCHA if prompted, then click Login."
npm run "$NPM_CMD"

echo ""
echo "▶ Copying session state to VPS…"
for f in "${STATE_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    scp "$f" hostinger:/opt/bpu-bot/"$f"
    echo "  ✓ $f"
  else
    echo "  ⚠ $f not found locally — skipping"
  fi
done

echo ""
echo "▶ Restarting bpu-bot on VPS so it picks up the new session…"
ssh hostinger 'pm2 restart bpu-bot --update-env' >/dev/null
sleep 3

echo ""
echo "▶ Verifying health…"
ssh hostinger 'curl -s http://localhost:3101/api/health -H "Authorization: Bearer $(grep API_SECRET /opt/bpu-bot/.env | cut -d= -f2)"' | python3 -m json.tool

echo ""
echo "✅ Done."
