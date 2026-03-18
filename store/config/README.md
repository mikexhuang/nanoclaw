# Sender Allowlist Configuration

Edit `sender-allowlist.json` to control who can trigger Butler:

1. Replace `FAMILY_GROUP_JID_PLACEHOLDER` with your WhatsApp group JID
   - Find it by running: `sqlite3 store/messages.db "SELECT jid, name FROM chats WHERE is_group=1"`
2. Replace `PARENT1_PHONE@s.whatsapp.net` with actual parent phone numbers
   - Format: country code + number, no spaces or +, e.g., `12125551234@s.whatsapp.net`
3. `logDenied: true` logs denied messages for debugging (set to false in production)

## Modes
- `trigger`: Only allowed senders can trigger @Butler. Others' messages are ignored.
- `drop`: Messages from non-allowed senders are dropped entirely (not stored).
