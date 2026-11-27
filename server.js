require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateGeminiReply } = require('./gemini');
const { sendWhatsAppMessage } = require('./whatsapp');
const { pushLeadToNeoDove } = require('./neodove');
const { scheduleFollowup, cancelFollowup, checkAndExecuteDueFollowups } = require('./followup');
const { getISTTimeInfo, cleanHumanName, stripEmojis, getSuggestedCallSlots, extractVitalsDeterministically, handleDeterministicFallback } = require('./utils');

const app = express();
app.use(express.json());
// Serve optimized transformation photos
app.use('/media', express.static(path.join(__dirname, 'public/media')));

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

// Comprehensive Lead Intelligence Endpoint
app.get('/api/leads', (req, res) => {
  const allLeads = [];
  for (const [phone, sess] of sessions.entries()) {
    const lastMsg = sess.history && sess.history.length > 0 ? sess.history[sess.history.length - 1] : null;
    allLeads.push({
      phone,
      name: sess.leadData?.name || sess.leadData?.finbiteName || 'Unknown',
      stage: sess.leadData?.lead_stage || (sess.leadData?.preferred_call_time ? 'appointment_booked' : (sess.history.length > 2 ? 'discovery' : 'fresh_lead')),
      goal: sess.leadData?.goal || 'Weight Loss',
      age: sess.leadData?.age || null,
      height: sess.leadData?.height || null,
      current_weight: sess.leadData?.current_weight || null,
      target_weight: sess.leadData?.target_weight || null,
      start_timeline: sess.leadData?.start_timeline || null,
      medical_conditions: sess.leadData?.medical_conditions || null,
      call_time: sess.leadData?.preferred_call_time || null,
      is_paid_comfortable: sess.leadData?.is_paid_comfortable !== undefined ? sess.leadData?.is_paid_comfortable : null,
      followupPending: sess.followupPending || false,
      followupCount: sess.followupCount || 0,
      totalMessages: sess.history?.length || 0,
      lastMessage: lastMsg ? { role: lastMsg.role, text: lastMsg.text?.substring(0, 120) } : null,
      lastUpdated: sess.lastUpdated || null
    });
  }
  res.json({
    timestamp: new Date().toISOString(),
    totalLeads: allLeads.length,
    leads: allLeads
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

    // Capture and clean Finbite sender name (filter weird/business/emoji handles)
    if (senderName && typeof senderName === 'string' && senderName.trim().length > 0 && senderName.trim().toLowerCase() !== 'unknown') {
      session.leadData.finbiteRawName = senderName.trim();
      const validHumanName = cleanHumanName(senderName);
      if (validHumanName) {
        session.leadData.finbiteName = validHumanName;
        // If customer has not confirmed a different name in chat, use valid human name
        if (!session.leadData.confirmedNameInChat && (!session.leadData.name || session.leadData.name.startsWith('Customer') || session.leadData.name.startsWith('Lead') || session.leadData.name.startsWith('WhatsApp'))) {
          session.leadData.name = validHumanName;
        }
      } else {
        console.log(`🧹 [Name Filtered] Ignored weird/commercial profile name "${senderName}" for ${senderPhone}`);
        // If name is not confirmed in chat and was set to an invalid handle, clear it
        if (!session.leadData.confirmedNameInChat) {
          session.leadData.name = null;
        }
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

    // Call Booked Guard: Once call is booked, any affirmative reply ("Yes", "Ok", "Haan", etc.) confirms appointment and NEVER restarts funnel
    const isCallAlreadyBooked = Boolean(
      (session.leadData?.preferred_call_time && String(session.leadData.preferred_call_time).trim() !== '') ||
      session.leadData?.lead_stage === 'appointment_booked'
    );
    const affirmativeKeywords = ['yes', 'haan', 'ha', 'ok', 'okay', 'sure', 'theek hai', 'done', 'yes mam', 'yes sir', 'shukriya', 'thanks', 'thank you', 'bilkul', 'ji'];

    if (isCallAlreadyBooked && affirmativeKeywords.includes(normalizedInput)) {
      const callTime = session.leadData.preferred_call_time || 'तय समय';
      console.log(`📞 [Call Already Booked] User ${senderPhone} replied "${incomingText}". Acknowledging confirmed appointment (${callTime}) without resetting funnel.`);
      
      const confirmReply = `बहुत बढ़िया! आपकी 10-मिनट की कंसल्टेशन कॉल आज ${callTime} के लिए कन्फर्म है। हमारे सीनियर हेल्थ एक्सपर्ट आपसे ठीक समय पर बात करेंगे।`;

      session.history.push({ role: 'user', text: incomingText });
      session.history.push({ role: 'model', text: confirmReply });
      session.lastUpdated = new Date();

      await sendWhatsAppMessage(senderPhone, confirmReply);
      saveSessionsToDisk();
      return;
    }

    // Fast-Path: ONLY when user clicks/types "YES" to the initial broadcast at Step 1 (NO call booked, NO vitals shared, NO active history)
    const hasAlreadySharedVitals = Boolean(session.leadData?.current_weight || session.leadData?.height || session.leadData?.age);
    const hasActiveHistory = Array.isArray(session.history) && session.history.length > 0;

    if ((normalizedInput === 'yes' || normalizedInput === 'haan') && !isCallAlreadyBooked && !hasAlreadySharedVitals && !hasActiveHistory) {
      console.log(`⚡ [Fast-Path YES] Initial broadcast response asking for Age, Weight & Height for ${senderPhone}...`);
      session.leadData = session.leadData || {};
      session.leadData.goal = 'Weight Loss';
      session.leadData.is_qualified = false;

      const istTime = getISTTimeInfo();
      const cleanName = session.leadData.name ? cleanHumanName(session.leadData.name) : null;

      let fastReply;
      if (cleanName) {
        fastReply = `Hi ${cleanName}! I am Aanya, Assistant at Diet Dekho.\n\nTo help our Senior Health Coach customize your natural weight loss assessment, please share these 3 quick details:\n\n1. Your Age?\n2. Your Current Weight (in kg)?\n3. Your Height (in feet/inches or cm)?`;
      } else {
        fastReply = `Hi! I am Aanya, Assistant at Diet Dekho.\n\nTo help our Senior Health Coach customize your natural weight loss assessment, please share these 3 quick details:\n\n1. Your Age?\n2. Your Current Weight (in kg)?\n3. Your Height (in feet/inches or cm)?`;
      }

      session.history.push({ role: 'user', text: incomingText });
      session.history.push({ role: 'model', text: fastReply });
      session.lastUpdated = new Date();

      await sendWhatsAppMessage(senderPhone, fastReply);

      // Register Fresh Lead in NeoDove immediately with clean name or fallback
      if (!session.leadData.alreadyCreatedInCrm) {
        await pushLeadToNeoDove({
          ...session.leadData,
          name: session.leadData.name || session.leadData.finbiteName || 'Fresh Lead',
          lead_stage: 'fresh_lead',
          lead_temperature: 'warm',
          is_qualified: false,
          summary: 'Tapped YES on 15kg broadcast campaign - awaiting age/weight/height.'
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

    // Deterministic Immediate Call Intent Guard ("Abhi", "Right now", "Abhi kar sakte hain", "Call me now"):
    const isImmediateCallRequest = /\babhi\b|right now|call now|turant|call me now|abhi kar/i.test(normalizedInput);
    if (isImmediateCallRequest) {
      session.leadData.preferred_call_time = 'Immediately (अगले 5-10 मिनट में)';
      session.leadData.lead_stage = 'appointment_booked';
      session.leadData.lead_temperature = 'hot';
      session.leadData.is_qualified = true;
      console.log(`🚨 [Immediate Call Requested] User ${senderPhone} asked for immediate call. Set preferred_call_time to Immediately.`);
    }

    // Deterministic 10 Baje / Ambiguous Time Slot Guard:
    // If previous bot message asked for call slot and user replies "10baje", "10 baje", "10:00", "10 am"
    const isTenBajeRequest = /^(10\s*baje|10baje|10:00|10\s*am|10\s*pm|10)\b/i.test(normalizedInput);
    const lastBotMessageForSlot = [...session.history].reverse().find(m => m.role === 'model')?.text || '';
    const isSlotPromptPending = /समय सही रहेगा|slot|call.*time|time.*call|3:00|5:30|1:00|4:30|4:45|6:15|6:30|11:30|कॉल सेट कर सकते हैं|समय चुनें/i.test(lastBotMessageForSlot);

    if (isTenBajeRequest && isSlotPromptPending) {
      const istTime = getISTTimeInfo();
      // If after 10:00 AM IST (totalMinutes >= 600), 10 AM today is past, so it means tomorrow morning 10:00 AM
      const resolvedSlot = istTime.totalMinutes >= 600 ? 'कल सुबह 10:00 AM' : 'आज सुबह 10:00 AM';
      session.leadData = session.leadData || {};
      session.leadData.preferred_call_time = resolvedSlot;
      session.leadData.lead_stage = 'appointment_booked';
      session.leadData.lead_temperature = 'hot';
      session.leadData.is_qualified = true;
      console.log(`⏰ [Deterministic 10 Baje Match] User ${senderPhone} replied "${incomingText}". Assigned slot: ${resolvedSlot}`);
    }

    // Deterministic Rejection / Unqualified Guard ("mehnga hai", "paid nahi chahiye", "free chahiye", "not interested", etc.)
    const isRejectionOrUnqualified = /\b(mehnga|mehenga|expensive|budget nahi|budget issue|free chahiye|free me|free plan|paid nahi|nhi chahiye|nahi chahiye|not interested|nahi lena|nhi lena|paise nahi|afford nahi|no budget|fees nahi|charges nahi)\b/i.test(normalizedInput);
    if (isRejectionOrUnqualified) {
      session.leadData = session.leadData || {};
      session.leadData.lead_stage = 'not_interested';
      session.leadData.is_paid_comfortable = false;
      session.leadData.is_qualified = false;
      session.leadData.lead_temperature = 'cold';
      session.followupPending = false;
      session.followupDueAt = null;
      cancelFollowup(senderPhone, session, saveSessionsToDisk);
      console.log(`🛑 [Deterministic Rejection Match] User ${senderPhone} signaled rejection: "${incomingText}". Set stage to not_interested and permanently killed follow-up.`);
    }

    // Deterministic Payment Intent Guard:
    // When customer asks about payment, UPI, bank transfer, payment link, or wants to pay now
    const isPaymentQuery = /\b(payment|pay|upi|gpay|phonepe|paytm|bank transfer|account number|scanner|qr code|kahan pay|kaise pay|bhejo link|payment link|paise kaise du|fees kaise du|bhugtan|kisko bheju|bhejo upi)\b/i.test(normalizedInput);
    if (isPaymentQuery) {
      console.log(`💳 [Deterministic Payment Guard] User ${senderPhone} asked about payment: "${incomingText}". Enforcing counselor payment policy.`);
      const callTime = session.leadData?.preferred_call_time;
      let paymentReply;
      if (callTime) {
        paymentReply = `डाइट देखो में भुगतान (Payment) की आधिकारिक प्रक्रिया और पेमेंट लिंक हमारे सीनियर हेल्थ काउंसलर 10-मिनट की कंसल्टेशन कॉल पर ही सुरक्षित रूप से साझा करते हैं।\n\nआपकी कॉल ${callTime} के लिए शेड्यूल्ड है, उसी समय काउंसलर आपको प्लान फाइनल करके आधिकारिक पेमेंट लिंक प्रदान करेंगे।`;
      } else {
        const slotInfo = getSuggestedCallSlots();
        paymentReply = `डाइट देखो में भुगतान (Payment) की आधिकारिक प्रक्रिया और पेमेंट लिंक हमारे सीनियर हेल्थ काउंसलर 10-मिनट की कंसल्टेशन कॉल पर आपकी ज़रूरत समझने के बाद ही सुरक्षित रूप से साझा करते हैं।\n\n${slotInfo.slotTextHindi}`;
      }

      const cleanReply = stripEmojis(paymentReply);
      session.history.push({ role: 'user', text: incomingText });
      session.history.push({ role: 'model', text: cleanReply });
      session.lastUpdated = new Date();

      await sendWhatsAppMessage(senderPhone, cleanReply);
      saveSessionsToDisk();
      return;
    }

    // Deterministic Vitals Pre-Parser (e.g. Pravin Yadav "48\n75kgd\n5 feet"):
    // Guarantees age, weight, and height are saved immediately into leadData even before AI call
    const detectedVitals = extractVitalsDeterministically(incomingText);
    if (detectedVitals) {
      session.leadData = session.leadData || {};
      if (detectedVitals.age && !session.leadData.age) session.leadData.age = detectedVitals.age;
      if (detectedVitals.weight && !session.leadData.current_weight) session.leadData.current_weight = detectedVitals.weight;
      if (detectedVitals.height && !session.leadData.height) session.leadData.height = detectedVitals.height;
      console.log(`🩺 [Deterministic Vitals Pre-Parsed] Extracted vitals for ${senderPhone}:`, detectedVitals);
    }

    // Call AI Engine with resilient fallback wrapper
    let replyText = '';
    let leadData = null;
    let interactionId = null;

    try {
      const aiResponse = await generateGeminiReply(
        session.history,
        incomingText,
        session.leadData,
        session.interactionId
      );
      replyText = aiResponse.replyText;
      leadData = aiResponse.leadData;
      interactionId = aiResponse.interactionId;
    } catch (aiError) {
      console.error(`⚠️ [AI Engine Fallback Triggered] AI failed for ${senderPhone}: ${aiError.message}. Executing resilient deterministic fallback...`);
      const fallbackResult = handleDeterministicFallback(session, incomingText);
      replyText = fallbackResult.replyText;
      leadData = fallbackResult.leadData;
    }

    // Safety: If AI reply is somehow empty or blank, execute fallback
    if (!replyText || replyText.trim() === '') {
      console.warn(`⚠️ [AI Empty Reply Safety] AI returned empty text for ${senderPhone}. Running fallback.`);
      const fallbackResult = handleDeterministicFallback(session, incomingText);
      replyText = fallbackResult.replyText;
      leadData = fallbackResult.leadData;
    }

    if (interactionId) session.interactionId = interactionId;

    // Strict Zero-Emoji Sanitization on outgoing model reply
    let cleanReplyText = stripEmojis(replyText);

    // Unbreakable Post-Generation Payment Safety Filter:
    // If AI ever hallucinates asking customer for their UPI ID, bank transfer details, or payment link
    const forbiddenPaymentPhrases = [
      'अपना upi', 'apna upi', 'bank transfer विवरण', 'बैंक ट्रांसफर',
      'payment link चाहते हैं', 'upi id bhejo', 'upi id', 'भुगतान प्रक्रिया तुरंत शुरू'
    ];
    if (forbiddenPaymentPhrases.some(phrase => cleanReplyText.toLowerCase().includes(phrase))) {
      console.warn(`⚠️ [Payment Hallucination Filter Triggered] AI asked customer for UPI/bank details. Neutralizing.`);
      const callTime = session.leadData?.preferred_call_time;
      cleanReplyText = callTime
        ? `डाइट देखो में भुगतान (Payment) की आधिकारिक प्रक्रिया और पेमेंट लिंक हमारे सीनियर हेल्थ काउंसलर 10-मिनट की कंसल्टेशन कॉल पर ही सुरक्षित रूप से साझा करते हैं। आपकी कॉल ${callTime} के लिए शेड्यूल्ड है, उसी समय काउंसलर आपको आधिकारिक लिंक प्रदान करेंगे।`
        : `डाइट देखो में भुगतान (Payment) की आधिकारिक प्रक्रिया और पेमेंट लिंक हमारे सीनियर हेल्थ काउंसलर 10-मिनट की कंसल्टेशन कॉल पर ही सुरक्षित रूप से साझा करते हैं। क्या आज का समय सही रहेगा?`;
    }

    // Update conversation history
    session.history.push({ role: 'user', text: incomingText });
    session.history.push({ role: 'model', text: cleanReplyText });

    // Keep history manageable (last 20 messages)
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }

    session.lastUpdated = new Date();

    // Send AI reply back to WhatsApp user
    if (cleanReplyText) {
      await sendWhatsAppMessage(senderPhone, cleanReplyText);
    }

    // Merge and persist lead data (never overwrite existing values with null/empty)
    if (leadData && typeof leadData === 'object') {
      console.log(`[Lead Data Extracted for ${senderPhone}]:`, JSON.stringify(leadData));
      
      // If customer provided a confirmed name in chat, validate and save
      if (leadData.name && typeof leadData.name === 'string' && leadData.name.trim().length > 1) {
        const validName = cleanHumanName(leadData.name.trim());
        if (validName) {
          session.leadData.name = validName;
          session.leadData.confirmedNameInChat = true;
          console.log(`👤 [CONFIRMED NAME] Customer shared real name in chat: "${validName}" for ${senderPhone}`);
        }
      }

      for (const [key, val] of Object.entries(leadData)) {
        if (key === 'name') continue; // Handled above
        if (val !== null && val !== undefined && val !== '') {
          session.leadData[key] = val;
        }
      }

      // If AI extracted not_interested or is_paid_comfortable === false, enforce rejection state
      if (leadData.lead_stage === 'not_interested' || leadData.is_paid_comfortable === false) {
        session.leadData.lead_stage = 'not_interested';
        session.leadData.is_paid_comfortable = false;
        session.leadData.is_qualified = false;
        session.leadData.lead_temperature = 'cold';
        session.followupPending = false;
        session.followupDueAt = null;
        cancelFollowup(senderPhone, session, saveSessionsToDisk);
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
      // 2. Real-Time NeoDove CRM Sync: Update as soon as name, call time, health stats, or rejection arrive
      const hasConfirmedName = Boolean(session.leadData.confirmedNameInChat && leadData?.name);
      const hasCallTime = Boolean(session.leadData.preferred_call_time);
      const hasStats = Boolean(leadData?.current_weight || leadData?.height || leadData?.age || leadData?.start_timeline || leadData?.medical_conditions || leadData?.is_paid_comfortable !== undefined);
      const isRejectionSync = Boolean(session.leadData.is_paid_comfortable === false || session.leadData.lead_stage === 'not_interested');

      if (hasConfirmedName || hasCallTime || hasStats || isRejectionSync) {
        if (hasCallTime && session.leadData.is_paid_comfortable !== false && session.leadData.lead_stage !== 'not_interested') {
          session.leadData.lead_stage = 'appointment_booked';
          session.leadData.lead_temperature = 'hot';
          session.leadData.is_qualified = true;
        } else if (session.leadData.is_paid_comfortable === false || session.leadData.lead_stage === 'not_interested') {
          session.leadData.lead_stage = 'not_interested';
          session.leadData.lead_temperature = 'cold';
          session.leadData.is_qualified = false;
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

    // Schedule smart 45-min follow-up (persisted to disk) - ONLY if lead is NOT disqualified
    const isUnqualified = ['opted_out', 'not_interested', 'unqualified', 'disqualified'].includes(session.leadData?.lead_stage) ||
                          session.leadData?.is_paid_comfortable === false;

    if (!isUnqualified) {
      scheduleFollowup(senderPhone, session, saveSessionsToDisk);
    } else {
      session.followupPending = false;
      session.followupDueAt = null;
      saveSessionsToDisk();
      console.log(`[Follow-up Skipped] ${senderPhone} is disqualified/not interested. No follow-up scheduled.`);
    }

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
