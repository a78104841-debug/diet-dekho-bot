require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateGeminiReply } = require('./gemini');
const { sendWhatsAppMessage } = require('./whatsapp');
const { pushLeadToNeoDove } = require('./neodove');
const { scheduleFollowup, cancelFollowup, checkAndExecuteDueFollowups } = require('./followup');

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
      // Check if any follow-up became due while restarting
      setTimeout(() => {
        checkAndExecuteDueFollowups(sessions, saveSessionsToDisk).catch(e => {});
      }, 5000);
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

// 1. Health check & Ping endpoints
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'Diet Dekho WhatsApp AI Lead Bot (v3)',
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// Follow-up Cron & Health Endpoint (hit by external pingers to keep alive & trigger follow-ups)
app.get('/cron/followup', async (req, res) => {
  try {
    await checkAndExecuteDueFollowups(sessions, saveSessionsToDisk);
    let pendingCount = 0;
    for (const s of sessions.values()) {
      if (s.followupPending) pendingCount++;
    }
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      activeSessions: sessions.size,
      pendingFollowups: pendingCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    let senderName = null;
    let incomingText = null;
    let messageId = null;

    if (body.data) {
      senderPhone = body.data.senderPhoneNumber;
      senderName = body.data.senderName || body.data.contact?.name || body.data.sender?.name || null;
      messageId = body.data.messageId;
      // Extract from all possible WhatsApp / Finbite message types (text, button, interactive buttonReply, listReply)
      incomingText = body.data.content?.text ||
                     body.data.content?.button?.text ||
                     body.data.content?.button?.payload ||
                     body.data.content?.buttonReply?.title ||
                     body.data.content?.buttonReply?.id ||
                     body.data.content?.interactive?.button_reply?.title ||
                     body.data.content?.interactive?.button_reply?.id ||
                     body.data.content?.interactive?.list_reply?.title ||
                     body.data.text ||
                     body.data.button?.text ||
                     body.data.button?.payload ||
                     '';
    } else if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const msg = body.entry[0].changes[0].value.messages[0];
      const contact = body.entry[0].changes[0].value.contacts?.[0];
      senderPhone = msg.from;
      senderName = contact?.profile?.name || null;
      messageId = msg.id;
      incomingText = msg.text?.body ||
                     msg.button?.text ||
                     msg.button?.payload ||
                     msg.interactive?.button_reply?.title ||
                     msg.interactive?.button_reply?.id ||
                     msg.interactive?.list_reply?.title ||
                     '';
    } else if (body.sender || body.from || body.phone) {
      senderPhone = body.sender || body.from || body.phone;
      senderName = body.senderName || body.name || null;
      messageId = body.messageId || `${senderPhone}_${Date.now()}`;
      incomingText = body.text ||
                     body.message ||
                     body.content?.text ||
                     body.content?.button?.text ||
                     body.content?.buttonReply?.title ||
                     body.button?.text ||
                     '';
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
    const session = getSession(senderPhone);
    session.leadData = session.leadData || {};

    // Capture and preserve Finbite sender name
    if (senderName && typeof senderName === 'string' && senderName.trim().length > 0 && senderName.trim().toLowerCase() !== 'unknown') {
      session.leadData.finbiteName = senderName.trim();
      // If customer has not confirmed a different name in chat, default to Finbite name
      if (!session.leadData.confirmedNameInChat && (!session.leadData.name || session.leadData.name.startsWith('Customer') || session.leadData.name.startsWith('Lead') || session.leadData.name.startsWith('WhatsApp'))) {
        session.leadData.name = senderName.trim();
      }
    }

    cancelFollowup(senderPhone, session, saveSessionsToDisk);

    // Native Opt-Out Guard: Only treat "NO" as opt-out on initial broadcast button click or turn 0.
    // If user is already chatting (e.g. answering "Do you have medical conditions? -> No"), do NOT suppress!
    const normalizedInput = incomingText.trim().toLowerCase();
    const isExplicitOptOut = normalizedInput === 'stop' || normalizedInput === 'unsubscribe';
    const isBroadcastNo = (normalizedInput === 'no' || normalizedInput === 'nahi') &&
                          (body.data?.messageType === 'button' || session.history.length === 0);

    if (isExplicitOptOut || isBroadcastNo) {
      console.log(`[Opt-Out] User ${senderPhone} replied "${incomingText}". Finbite handles opt-out natively. Suppressing AI reply.`);
      session.leadData = session.leadData || {};
      session.leadData.lead_stage = 'opted_out';
      session.followupPending = false;
      saveSessionsToDisk();
      return;
    }

    // Fast-Path: When user clicks/types "YES" to the broadcast, reply instantly asking for Height & Weight
    if (normalizedInput === 'yes') {
      console.log(`⚡ [Fast-Path YES] Instant broadcast response asking for Height & Weight for ${senderPhone}...`);
      session.leadData = session.leadData || {};
      session.leadData.goal = 'Weight Loss';
      session.leadData.is_qualified = false;
      if (session.leadData.finbiteName && (!session.leadData.name || session.leadData.name.startsWith('Customer') || session.leadData.name.startsWith('Lead') || session.leadData.name.startsWith('WhatsApp'))) {
        session.leadData.name = session.leadData.finbiteName;
      }

      const fastReply = "Awesome! We'd love to help you with your 15 kg weight-loss journey 🌱 To help our health coach prepare the right assessment, could you share your approximate height and current weight?";

      session.history.push({ role: 'user', text: incomingText });
      session.history.push({ role: 'model', text: fastReply });
      session.lastUpdated = new Date();

      await sendWhatsAppMessage(senderPhone, fastReply);

      // Register Fresh Lead in NeoDove immediately with Finbite profile name
      if (!session.leadData.alreadyCreatedInCrm) {
        await pushLeadToNeoDove({
          ...session.leadData,
          lead_stage: 'fresh_lead',
          lead_temperature: 'warm',
          is_qualified: false,
          summary: 'Tapped YES on 15kg broadcast campaign - awaiting height/weight.'
        }, senderPhone, false);
        session.leadData.alreadyCreatedInCrm = true;
      }

      saveSessionsToDisk();
      scheduleFollowup(senderPhone, session, saveSessionsToDisk);
      return;
    }

    // Deterministic Medical Answer Guard:
    // If previous bot message asked about health conditions and user answers "No" / "None" / "Nahi":
    const lastBotMessage = [...session.history].reverse().find(m => m.role === 'model')?.text || '';
    const isMedicalQuestionPending = /health conditions|thyroid|pcod|diabetes|bp|acidity|bimari/i.test(lastBotMessage);
    if (isMedicalQuestionPending && (!session.leadData.medical_conditions || session.leadData.medical_conditions === 'None')) {
      const lower = normalizedInput;
      if (['no', 'nahi', 'none', 'na', 'nothing', 'no disease', 'no issue', 'fit', 'normal', 'nhi', 'not yet', 'no problems', 'sab theek'].includes(lower)) {
        session.leadData.medical_conditions = 'None';
        console.log(`🩺 [Deterministic Medical Match] Explicitly set medical_conditions to "None" for ${senderPhone}`);
      }
    }

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
      
      // If customer provided a confirmed name in chat, save and mark confirmed
      if (leadData.name && typeof leadData.name === 'string' && leadData.name.trim().length > 1) {
        const rawName = leadData.name.trim();
        const nonNames = ['no', 'none', 'nahi', 'null', 'undefined', 'na', 'unknown'];
        if (!nonNames.includes(rawName.toLowerCase())) {
          session.leadData.name = rawName;
          session.leadData.confirmedNameInChat = true;
          console.log(`👤 [CONFIRMED NAME] Customer shared real name in chat: "${rawName}" for ${senderPhone}`);
        }
      }

      for (const [key, val] of Object.entries(leadData)) {
        if (key === 'name') continue; // Handled above
        if (val !== null && val !== undefined && val !== '') {
          session.leadData[key] = val;
        }
      }
    }

    // 1. Fresh Lead Registration: Register on NeoDove on very first inbound contact
    if (!session.leadData.alreadyCreatedInCrm) {
      console.log(`📥 [NEODOVE FRESH LEAD] Creating initial lead for ${senderPhone} (Name: ${session.leadData.name || session.leadData.finbiteName || 'Fresh Lead'})...`);
      const freshLeadPayload = {
        ...session.leadData,
        name: session.leadData.name || session.leadData.finbiteName,
        lead_stage: 'fresh_lead',
        lead_temperature: 'warm',
        is_qualified: false,
        summary: `Fresh broadcast reply. First message: "${incomingText.substring(0, 100)}"`
      };
      const created = await pushLeadToNeoDove(freshLeadPayload, senderPhone, false);
      if (created) {
        session.leadData.alreadyCreatedInCrm = true;
      }
    } else {
      // 2. Real-Time NeoDove CRM Sync: Update as soon as name, call time, or health stats arrive
      const hasConfirmedName = Boolean(session.leadData.confirmedNameInChat && leadData?.name);
      const hasCallTime = Boolean(session.leadData.preferred_call_time);
      const hasStats = Boolean(leadData?.current_weight || leadData?.medical_conditions || leadData?.is_paid_comfortable !== undefined);

      if (hasConfirmedName || hasCallTime || hasStats) {
        if (hasCallTime) {
          session.leadData.lead_stage = 'appointment_booked';
          session.leadData.lead_temperature = 'hot';
          session.leadData.is_qualified = true;
        } else if (session.leadData.is_paid_comfortable) {
          session.leadData.lead_stage = 'qualified';
          session.leadData.lead_temperature = 'hot';
        }

        console.log(`🔄 [NEODOVE SYNC] Updating lead in NeoDove CRM for ${senderPhone} (Name: ${session.leadData.name}, Stage: ${session.leadData.lead_stage})...`);
        await pushLeadToNeoDove(session.leadData, senderPhone, true);
      }
    }

    // Save session to disk immediately
    saveSessionsToDisk();

    // Schedule smart 45-min follow-up (persisted to disk)
    scheduleFollowup(senderPhone, session, saveSessionsToDisk);

  } catch (error) {
    addDebugLog('Webhook Processing Error', error.message || String(error));
  }
});

// Periodic background follow-up worker (runs every 60 seconds)
setInterval(() => {
  checkAndExecuteDueFollowups(sessions, saveSessionsToDisk).catch(err => {
    console.error('[Follow-up Loop Error]:', err.message);
  });
}, 60 * 1000);

// Keep-alive self ping every 8 minutes
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL || 'https://diet-dekho-bot.onrender.com';
  axios.get(`${url}/ping`).catch(() => {});
}, 8 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Diet Dekho WhatsApp Bot Server running on port ${PORT}`);
  console.log(`📍 Webhook URL path: /webhook`);
});
