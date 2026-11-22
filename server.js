require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { generateGeminiReply } = require('./gemini');
const { sendWhatsAppMessage } = require('./whatsapp');
const { pushLeadToNeoDove } = require('./neodove');
const { scheduleFollowup, cancelFollowup } = require('./followup');

const app = express();
app.use(express.json());

// File-backed session persistence so user details are NEVER lost on restart
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache synced with disk
const sessions = new Map();

function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      for (const [phone, session] of Object.entries(data)) {
        sessions.set(phone, session);
      }
      console.log(`[Persistence] Loaded ${sessions.size} sessions from disk.`);
    }
  } catch (err) {
    console.error('[Persistence] Error loading sessions:', err.message);
  }
}

function saveSessionsToDisk() {
  try {
    const obj = {};
    for (const [phone, session] of sessions.entries()) {
      obj[phone] = session;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('[Persistence] Error saving sessions:', err.message);
  }
}

loadSessionsFromDisk();

// In-memory debug logs
const debugLogs = [];
function addDebugLog(msg, data = null) {
  const entry = { time: new Date().toISOString(), msg, data };
  debugLogs.push(entry);
  if (debugLogs.length > 50) debugLogs.shift();
  console.log(`[${entry.time}] ${msg}`, data ? JSON.stringify(data) : '');
}

app.get('/debug', (req, res) => {
  res.json({
    status: 'online',
    totalSessions: sessions.size,
    recentLogs: debugLogs.slice(-20)
  });
});

// Deduplication cache for message IDs
const processedMessageIds = new Set();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      history: [],
      leadData: {},
      interactionId: null,
      lastUpdated: new Date()
    });
    saveSessionsToDisk();
  }
  return sessions.get(phone);
}

// 1. Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'Diet Dekho WhatsApp AI Lead Bot (v3)',
    timestamp: new Date().toISOString()
  });
});

// 2. Webhook verification endpoint (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (token === (process.env.WEBHOOK_VERIFY_TOKEN || 'dietdekho_secure_token_123')) {
      console.log('[Webhook Verification] Successfully verified challenge.');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  res.status(200).send('Diet Dekho Webhook Endpoint is Ready.');
});

// 3. Webhook listener endpoint (POST)
app.post('/webhook', async (req, res) => {
  res.status(200).json({ status: 'received' });

  try {
    const body = req.body;
    addDebugLog('Incoming Webhook', body);

    let senderPhone = null;
    let incomingText = null;
    let messageId = null;

    if (body.data) {
      senderPhone = body.data.senderPhoneNumber;
      messageId = body.data.messageId;
      incomingText = body.data.content?.text || body.data.text || '';
    } else if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const msg = body.entry[0].changes[0].value.messages[0];
      senderPhone = msg.from;
      messageId = msg.id;
      incomingText = msg.text?.body || '';
    } else if (body.sender || body.from || body.phone) {
      senderPhone = body.sender || body.from || body.phone;
      incomingText = body.text || body.message || '';
      messageId = body.messageId || `${senderPhone}_${Date.now()}`;
    }

    if (!senderPhone || !incomingText || incomingText.trim() === '') {
      return;
    }

    if (messageId && processedMessageIds.has(messageId)) {
      console.log(`[Webhook] Duplicate messageId ${messageId} ignored.`);
      return;
    }
    if (messageId) {
      processedMessageIds.add(messageId);
      setTimeout(() => processedMessageIds.delete(messageId), 10 * 60 * 1000);
    }

    addDebugLog(`Message Received from ${senderPhone}: "${incomingText}"`);
    cancelFollowup(senderPhone);

    const session = getSession(senderPhone);

    // Call AI Engine with history, user message, and known lead memory
    const { replyText, leadData, interactionId } = await generateGeminiReply(
      session.history,
      incomingText,
      session.leadData,
      session.interactionId
    );

    if (interactionId) session.interactionId = interactionId;

    // Update conversation history
    session.history.push({ role: 'user', text: incomingText });
    session.history.push({ role: 'model', text: replyText });

    // Keep history manageable (last 20 messages)
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }

    session.lastUpdated = new Date();

    // Send AI reply back to WhatsApp user
    if (replyText) {
      await sendWhatsAppMessage(senderPhone, replyText);
    }

    // Merge and persist lead data (never overwrite existing values with null/empty)
    if (leadData && typeof leadData === 'object') {
      console.log(`[Lead Data Extracted for ${senderPhone}]:`, JSON.stringify(leadData));
      for (const [key, val] of Object.entries(leadData)) {
        if (val !== null && val !== undefined && val !== '') {
          session.leadData[key] = val;
        }
      }

      // Push to NeoDove if newly qualified
      if (session.leadData.is_qualified && !session.leadData.alreadyPushedToCrm) {
        console.log(`🎉 [LEAD QUALIFIED] Pushing to CRM for ${senderPhone}...`);
        await pushLeadToNeoDove(session.leadData, senderPhone);
        session.leadData.alreadyPushedToCrm = true;
      }
    }

    // Save session to disk immediately
    saveSessionsToDisk();

    // Schedule smart follow-up if not yet qualified
    scheduleFollowup(senderPhone, session.history, session.leadData);

  } catch (error) {
    addDebugLog('Webhook Processing Error', error.message || String(error));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Diet Dekho WhatsApp Bot Server running on port ${PORT}`);
  console.log(`📍 Webhook URL path: /webhook`);
});
