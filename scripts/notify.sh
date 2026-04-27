#!/bin/bash

# ClaudeClaw Notification Script
# Sends notifications via Telegram, WhatsApp, or Slack

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
MESSAGE=""
TITLE="ClaudeClaw"
LEVEL="info"  # info, warning, error
CHANNELS="telegram"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -m|--message)
      MESSAGE="$2"
      shift 2
      ;;
    -t|--title)
      TITLE="$2"
      shift 2
      ;;
    -l|--level)
      LEVEL="$2"
      shift 2
      ;;
    -c|--channel)
      CHANNELS="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: notify.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  -m, --message TEXT   Message to send (required)"
      echo "  -t, --title TEXT     Title for notification (default: ClaudeClaw)"
      echo "  -l, --level LEVEL    Level: info, warning, error (default: info)"
      echo "  -c, --channel CHS    Channels: telegram, whatsapp, slack, all (default: telegram)"
      echo "  -h, --help           Show this help message"
      echo ""
      echo "Examples:"
      echo "  ./notify.sh -m 'Task completed' -c telegram"
      echo "  ./notify.sh -m 'Error occurred' -l error -c all"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Validate message
if [ -z "$MESSAGE" ]; then
  echo -e "${RED}Error: Message is required. Use -m or --message${NC}"
  exit 1
fi

# Load environment variables
if [ -f "$(dirname "$0")/../.env" ]; then
  export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

# Format message based on level
case $LEVEL in
  info)
    EMOJI="ℹ️"
    ;;
  warning)
    EMOJI="⚠️"
    ;;
  error)
    EMOJI="❌"
    ;;
  *)
    EMOJI="📢"
    ;;
esac

FORMATTED_MESSAGE="${EMOJI} *${TITLE}*

${MESSAGE}

---
Sent by ClaudeClaw"

# Send via Telegram
send_telegram() {
  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    echo -e "${YELLOW}Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set${NC}"
    return
  fi
  
  echo "Sending Telegram notification..."
  
  local response=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${FORMATTED_MESSAGE}" \
    -d "parse_mode=markdown")
  
  if echo "$response" | grep -q '"ok":true'; then
    echo -e "${GREEN}✅ Telegram notification sent${NC}"
  else
    echo -e "${RED}❌ Telegram notification failed${NC}"
    echo "$response"
  fi
}

# Send via WhatsApp
send_whatsapp() {
  if [ -z "$WHATSAPP_NUMBER" ]; then
    echo -e "${YELLOW}Warning: WHATSAPP_NUMBER not set${NC}"
    return
  fi
  
  echo "Sending WhatsApp notification..."
  
  # Note: This requires ClaudeClaw to be running with WhatsApp enabled
  # The actual sending is done through the ClaudeClaw API
  local response=$(curl -s -X POST "http://localhost:3000/api/whatsapp/send" \
    -H "Content-Type: application/json" \
    -d "{\"number\": \"${WHATSAPP_NUMBER}\", \"message\": \"${MESSAGE}\"}" 2>/dev/null || echo '{"ok":false}')
  
  if echo "$response" | grep -q '"ok":true'; then
    echo -e "${GREEN}✅ WhatsApp notification sent${NC}"
  else
    echo -e "${YELLOW}⚠️ WhatsApp notification skipped (service unavailable)${NC}"
  fi
}

# Send via Slack
send_slack() {
  if [ -z "$SLACK_BOT_TOKEN" ] || [ -z "$SLACK_CHANNEL" ]; then
    echo -e "${YELLOW}Warning: SLACK_BOT_TOKEN or SLACK_CHANNEL not set${NC}"
    return
  fi
  
  echo "Sending Slack notification..."
  
  local color="good"
  case $LEVEL in
    warning) color="warning" ;;
    error) color="danger" ;;
  esac
  
  local payload=$(cat <<EOF
{
  "channel": "${SLACK_CHANNEL}",
  "username": "ClaudeClaw",
  "icon_emoji": ":robot_face:",
  "attachments": [
    {
      "color": "${color}",
      "title": "${TITLE}",
      "text": "${MESSAGE}",
      "footer": "ClaudeClaw",
      "ts": $(date +%s)
    }
  ]
}
EOF
)
  
  local response=$(curl -s -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload")
  
  if echo "$response" | grep -q '"ok":true'; then
    echo -e "${GREEN}✅ Slack notification sent${NC}"
  else
    echo -e "${RED}❌ Slack notification failed${NC}"
    echo "$response"
  fi
}

# Main execution
echo "Sending notification to: $CHANNELS"

case $CHANNELS in
  telegram)
    send_telegram
    ;;
  whatsapp)
    send_whatsapp
    ;;
  slack)
    send_slack
    ;;
  all)
    send_telegram
    send_whatsapp
    send_slack
    ;;
  *)
    echo -e "${RED}Unknown channel: $CHANNELS${NC}"
    exit 1
    ;;
esac

echo "Done."