import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || "change_this_verify_token";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const TIME_ZONE = process.env.TIME_ZONE || "Asia/Kolkata";
const DEFAULT_STUDY_TIME = process.env.DEFAULT_STUDY_TIME || "20:30";
const REMINDER_TEMPLATE = process.env.WHATSAPP_REMINDER_TEMPLATE || "";
const TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US";

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users: {} }, null, 2));
  }
}

async function readStore() {
  await ensureDataFile();
  return JSON.parse(await fs.readFile(USERS_FILE, "utf8"));
}

async function writeStore(store) {
  await ensureDataFile();
  await fs.writeFile(USERS_FILE, JSON.stringify(store, null, 2));
}

function todayParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const data = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${data.year}-${data.month}-${data.day}`,
    time: `${data.hour}:${data.minute}`
  };
}

function randomCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function getUser(store, waId) {
  if (!store.users[waId]) {
    store.users[waId] = {
      waId,
      verified: false,
      stopped: false,
      studyTime: DEFAULT_STUDY_TIME,
      createdAt: new Date().toISOString(),
      lastStudyStartedDate: "",
      lastDoneDate: "",
      lastBusyDate: "",
      busyReason: "",
      busyNextTime: "",
      lastReminderDate: ""
    };
  }
  return store.users[waId];
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isValidSignature(rawBody, signatureHeader) {
  if (!META_APP_SECRET) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", META_APP_SECRET).update(rawBody).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}

async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log("Missing WhatsApp credentials. Would send:", to, text);
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`WhatsApp text send failed: ${response.status} ${await response.text()}`);
  }
}

async function sendReminder(to) {
  const text = "You forgot today's study. Start 25 minutes now.";

  if (!REMINDER_TEMPLATE) {
    await sendWhatsAppText(to, text);
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: REMINDER_TEMPLATE,
          language: { code: TEMPLATE_LANGUAGE }
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`WhatsApp template send failed: ${response.status} ${await response.text()}`);
  }
}

async function handleCommand(waId, text) {
  const store = await readStore();
  const user = getUser(store, waId);
  const input = text.trim();
  const upper = input.toUpperCase();
  const { date } = todayParts();

  let reply;

  if (upper === "START") {
    user.verificationCode = randomCode();
    user.stopped = false;
    reply = `Study Bot verification code: ${user.verificationCode}\nReply VERIFY ${user.verificationCode} to activate reminders.`;
  } else if (upper.startsWith("VERIFY ")) {
    const code = input.split(/\s+/)[1];
    if (code && code === user.verificationCode) {
      user.verified = true;
      user.verificationCode = "";
      user.stopped = false;
      reply = `Verified. Daily study time is ${user.studyTime}.\nCommands: TIME 20:30, STUDY START, DONE, BUSY reason, STOP.`;
    } else {
      reply = "Wrong verification code. Send START to get a new code.";
    }
  } else if (!user.verified) {
    reply = "Please send START first, then verify the code before reminders can start.";
  } else if (upper === "STOP") {
    user.stopped = true;
    reply = "Stopped. I will not send reminders. Send START to activate again.";
  } else if (upper === "HELP") {
    reply = "Commands: TIME 20:30, STUDY START, DONE, BUSY work shift study at 22:15, PRIVACY, INVITE, STOP.";
  } else if (upper.startsWith("TIME ")) {
    const value = input.slice(5).trim();
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      user.studyTime = value;
      reply = `Study reminder time set to ${value}.`;
    } else {
      reply = "Use 24-hour format. Example: TIME 20:30";
    }
  } else if (upper === "STUDY START") {
    user.lastStudyStartedDate = date;
    reply = "Good. Study marked as started for today. Do 25 focused minutes now.";
  } else if (upper === "DONE") {
    user.lastDoneDate = date;
    user.lastStudyStartedDate = date;
    reply = "Done marked for today. Nice work.";
  } else if (upper.startsWith("BUSY")) {
    const reason = input.slice(4).trim();
    const hasNextTime = /\b([01]?\d|2[0-3]):[0-5]\d\b/.test(reason) || /\b\d{1,2}\s?(AM|PM)\b/i.test(reason);
    if (reason.length >= 12 && hasNextTime) {
      user.lastBusyDate = date;
      user.busyReason = reason;
      reply = "Busy reason accepted for today. I will still expect study at your next time.";
    } else {
      reply = "Send reason + next study time. Example: BUSY work shift, study at 22:15";
    }
  } else if (upper === "PRIVACY") {
    reply = "Privacy: I only store your WhatsApp ID, verification status, study time, today's study status, busy reason, and reminder history. I do not read files, contacts, private chats, or ChatGPT history.";
  } else if (upper === "INVITE") {
    reply = "Share this: Message START to this WhatsApp study bot. It will only activate after your own verification code.";
  } else {
    reply = "I did not understand. Send HELP for commands.";
  }

  await writeStore(store);
  await sendWhatsAppText(waId, reply);
}

async function handleWebhookPayload(payload) {
  const changes = payload.entry?.flatMap((entry) => entry.changes || []) || [];

  for (const change of changes) {
    const messages = change.value?.messages || [];
    for (const message of messages) {
      if (message.type !== "text") continue;
      await handleCommand(message.from, message.text?.body || "");
    }
  }
}

async function reminderTick() {
  const store = await readStore();
  const { date, time } = todayParts();
  let changed = false;

  for (const user of Object.values(store.users)) {
    if (!user.verified || user.stopped) continue;
    if (user.studyTime !== time) continue;
    if (user.lastReminderDate === date) continue;
    if (user.lastStudyStartedDate === date || user.lastDoneDate === date || user.lastBusyDate === date) continue;

    try {
      await sendReminder(user.waId);
      user.lastReminderDate = date;
      changed = true;
    } catch (error) {
      console.error("Reminder failed:", user.waId, error);
    }
  }

  if (changed) await writeStore(store);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Study WhatsApp Bot is running.");
      return;
    }

    if (req.method === "GET" && url.pathname === "/webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(challenge);
      } else {
        res.writeHead(403);
        res.end("Forbidden");
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      const rawBody = await parseBody(req);
      if (!isValidSignature(rawBody, req.headers["x-hub-signature-256"])) {
        res.writeHead(403);
        res.end("Bad signature");
        return;
      }

      await handleWebhookPayload(JSON.parse(rawBody.toString("utf8")));
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("Server error");
  }
});

await ensureDataFile();
setInterval(() => {
  reminderTick().catch((error) => console.error("Reminder tick failed:", error));
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`Study WhatsApp Bot listening on port ${PORT}`);
});
