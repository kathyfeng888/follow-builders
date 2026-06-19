#!/usr/bin/env node

// ============================================================================
// Follow Builders — Delivery Script
// ============================================================================
// Sends a digest to the user via their chosen delivery method.
// Supports: Feishu/Lark webhook, Telegram bot, Email (via Resend), or stdout.
//
// Usage:
//   echo "digest text" | node deliver.js
//   node deliver.js --message "digest text"
//   node deliver.js --file /path/to/digest.txt
//
// The script reads delivery config from ~/.follow-builders/config.json
// and API keys from ~/.follow-builders/.env
//
// Delivery methods:
//   - "feishu": sends via Feishu custom bot webhook (needs FEISHU_WEBHOOK_URL env)
//   - "telegram": sends via Telegram Bot API (needs TELEGRAM_BOT_TOKEN + chat ID)
//   - "email": sends via Resend API (needs RESEND_API_KEY + email address)
//   - "stdout" (default): just prints to terminal
// ============================================================================

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { config as loadEnv } from 'dotenv';

// -- Constants ---------------------------------------------------------------

const USER_DIR = join(homedir(), '.follow-builders');
const CONFIG_PATH = join(USER_DIR, 'config.json');
const ENV_PATH = join(USER_DIR, '.env');

// -- Read input --------------------------------------------------------------

// The digest text can come from stdin, --message flag, or --file flag
async function getDigestText() {
  const args = process.argv.slice(2);

  // Check --message flag
  const msgIdx = args.indexOf('--message');
  if (msgIdx !== -1 && args[msgIdx + 1]) {
    return args[msgIdx + 1];
  }

  // Check --file flag
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    return await readFile(args[fileIdx + 1], 'utf-8');
  }

  // Read from stdin
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// -- Telegram Delivery -------------------------------------------------------

// Sends the digest via Telegram Bot API.
// The user creates a bot via @BotFather and provides the token.
// The chat ID is obtained when the user sends their first message to the bot.
async function sendTelegram(text, botToken, chatId) {
  // Telegram has a 4096 character limit per message.
  // If the digest is longer, we split it into chunks.
  const MAX_LEN = 4000;
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitAt < MAX_LEN * 0.5) splitAt = MAX_LEN;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  for (const chunk of chunks) {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      }
    );

    if (!res.ok) {
      const err = await res.json();
      // If Markdown parsing fails, retry without parse_mode
      if (err.description && err.description.includes("can't parse")) {
        await fetch(
          `https://api.telegram.org/bot${botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: chunk,
              disable_web_page_preview: true
            })
          }
        );
      } else {
        throw new Error(`Telegram API error: ${err.description}`);
      }
    }

    // Small delay between chunks to avoid rate limiting
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
  }
}

// -- Feishu/Lark Webhook Delivery --------------------------------------------

// Sends the digest via Feishu custom bot webhook.
// The user creates a custom bot in a Feishu group and provides the webhook URL.
// Supports both interactive card (rich markdown) and text fallback.
async function sendFeishu(text, webhookUrl) {
  // Feishu webhook has a ~30KB limit per message.
  // Split into chunks if too long.
  const MAX_LEN = 15000;
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n\n', MAX_LEN);
    if (splitAt < MAX_LEN * 0.3) splitAt = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitAt < MAX_LEN * 0.3) splitAt = MAX_LEN;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  for (const chunk of chunks) {
    // Try interactive card first (better formatting)
    const cardPayload = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: '🤖 AI Builders Digest' },
          subtitle: { tag: 'plain_text', content: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) }
        },
        elements: [
          { tag: 'markdown', content: chunk }
        ]
      }
    };

    let res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardPayload)
    });

    // If card fails, fall back to plain text
    if (!res.ok) {
      const textPayload = {
        msg_type: 'text',
        content: { text: chunk }
      };
      res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(textPayload)
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Feishu API error: ${err}`);
    }

    if (chunks.length > 1) await new Promise(r => setTimeout(r, 1000));
  }
}

// -- Email Delivery (Resend) -------------------------------------------------

// Sends the digest via Resend's email API.
// The user provides their own Resend API key and email address.
async function sendEmail(text, apiKey, toEmail) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: 'AI Builders Digest <digest@resend.dev>',
      to: [toEmail],
      subject: `AI Builders Digest — ${new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })}`,
      text: text
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Resend API error: ${err.message || JSON.stringify(err)}`);
  }
}

// -- Main --------------------------------------------------------------------

async function main() {
  // Load env and config
  loadEnv({ path: ENV_PATH });

  let config = {};
  if (existsSync(CONFIG_PATH)) {
    config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
  }

  const delivery = config.delivery || { method: 'stdout' };
  const digestText = await getDigestText();

  if (!digestText || digestText.trim().length === 0) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'Empty digest text' }));
    return;
  }

  try {
    switch (delivery.method) {
      case 'telegram': {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = delivery.chatId;
        if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not found in .env');
        if (!chatId) throw new Error('delivery.chatId not found in config.json');
        await sendTelegram(digestText, botToken, chatId);
        console.log(JSON.stringify({
          status: 'ok',
          method: 'telegram',
          message: 'Digest sent to Telegram'
        }));
        break;
      }

      case 'feishu': {
        const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
        if (!webhookUrl) throw new Error('FEISHU_WEBHOOK_URL not found in environment');
        await sendFeishu(digestText, webhookUrl);
        console.log(JSON.stringify({
          status: 'ok',
          method: 'feishu',
          message: 'Digest sent to Feishu'
        }));
        break;
      }

      case 'email': {
        const apiKey = process.env.RESEND_API_KEY;
        const toEmail = delivery.email;
        if (!apiKey) throw new Error('RESEND_API_KEY not found in .env');
        if (!toEmail) throw new Error('delivery.email not found in config.json');
        await sendEmail(digestText, apiKey, toEmail);
        console.log(JSON.stringify({
          status: 'ok',
          method: 'email',
          message: `Digest sent to ${toEmail}`
        }));
        break;
      }

      case 'stdout':
      default:
        // Just print to terminal — the agent or OpenClaw handles delivery
        console.log(digestText);
        break;
    }
  } catch (err) {
    console.log(JSON.stringify({
      status: 'error',
      method: delivery.method,
      message: err.message
    }));
    process.exit(1);
  }
}

main();
