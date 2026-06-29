# Study WhatsApp Bot

This is a privacy-first WhatsApp study reminder bot for Meta WhatsApp Cloud API.

It does not read private files, ChatGPT chats, contacts, gallery, or WhatsApp chats. It only receives messages that a user sends directly to the bot.

## Features

- Starts only after WhatsApp opt-in and bot verification.
- Supports friends. Each friend must send `START` and verify their own number.
- Stores only minimum study data in `data/users.json`.
- Daily warning if study was not started:

```text
You forgot today's study. Start 25 minutes now.
```

- Commands:

```text
START
VERIFY 123456
TIME 20:30
STUDY START
DONE
BUSY work shift, study at 22:15
PRIVACY
INVITE
STOP
HELP
```

## Important WhatsApp Limit

WhatsApp cannot force a muted phone to ring. Use a phone alarm for loud ringing.

Also, proactive reminders outside the 24-hour WhatsApp service window normally need an approved WhatsApp message template. This bot can use a template if you set `WHATSAPP_REMINDER_TEMPLATE`.

## Environment Variables

Create these on your hosting service:

```text
WHATSAPP_TOKEN=your_meta_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WEBHOOK_VERIFY_TOKEN=choose_a_private_verify_word
META_APP_SECRET=optional_app_secret
PORT=3000
TIME_ZONE=Asia/Kolkata
DEFAULT_STUDY_TIME=20:30
WHATSAPP_REMINDER_TEMPLATE=study_reminder_warning
WHATSAPP_TEMPLATE_LANGUAGE=en_US
```

Do not paste tokens in public chats or screenshots.

## Run Locally

```bash
npm start
```

Local running is useful for testing code, but Meta webhooks need a public HTTPS URL.

## Deploy

Use a long-running Node host such as Render, Railway, Fly.io, or a VPS.

After deploy, your webhook URL will be:

```text
https://your-domain.example/webhook
```

In Meta Developer Dashboard:

1. Open your app.
2. Go to WhatsApp.
3. Open Configuration or Webhooks.
4. Callback URL: `https://your-domain.example/webhook`
5. Verify token: same value as `WEBHOOK_VERIFY_TOKEN`.
6. Subscribe to `messages`.

## First User Test

From your WhatsApp number, message the test WhatsApp number:

```text
START
```

The bot replies with a code. Then reply:

```text
VERIFY 123456
```

After verification:

```text
TIME 20:30
STUDY START
DONE
```

## Reminder Template

For real daily reminders, create an approved WhatsApp template in Meta:

Template name:

```text
study_reminder_warning
```

Body:

```text
You forgot today's study. Start 25 minutes now.
```

Then set:

```text
WHATSAPP_REMINDER_TEMPLATE=study_reminder_warning
```

If no template is configured, the bot tries normal text messages. Those may fail outside the 24-hour service window.
