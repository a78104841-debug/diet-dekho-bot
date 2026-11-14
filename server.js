require('dotenv').config();
const express = require('express');
const { generateGeminiReply } = require('./gemini');
const { sendWhatsAppMessage } = require('./whatsapp');
const { pushLeadToNeoDove } = require('./neodove');
const { scheduleFollowup, cancelFollowup } = require('./followup');

const app = express();
app.use(express.json());

// In-memory session store: { [phone]: { history: [], leadData: {}, lastUpdated: Date } }
const sessions = new Map();

// Deduplication cache for message IDs: Set of messageIds processed in the last 10 minutes
const processedMessageIds = new Set();

/**
 * Helper to get or create a session for a phone number
 */
function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      history: [],
      leadData: null,
      lastUpdated: new Date()
    });
  }
  return sessions.get(phone);
}

// 1. Health check endpoint (Used by Render to verify service is alive)
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'Diet Dekho WhatsApp AI Lead Bot',
    timestamp: new Date().toISOString()
  });
});

// 2. Webhook verification endpoint (GET)
app.get('/webhook', (req, res) => {
  // Support standard Meta verification handshake if Finbite requires it
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
  // Immediately return 200 OK so the WhatsApp provider doesn't timeout
  res.status(200).json({ status: 'received' });

  try {
    const body = req.body;
    console.log('[Incoming Webhook Body]:', JSON.stringify(body, null, 2));

    let senderPhone = null;
    let incomingText = null;
    let messageId = null;

    // Format 1: Finbite standard event format
    // { event: "message-received", data: { senderPhoneNumber, content: { text }, messageId } }
    if (body.data) {
      senderPhone = body.data.senderPhoneNumber;
      messageId = body.data.messageId;
      incomingText = body.data.content?.text || body.data.text || '';
    } 
    // Format 2: Meta Cloud API standard format
    else if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const msg = body.entry[0].changes[0].value.messages[0];
      senderPhone = msg.from;
      messageId = msg.id;
      incomingText = msg.text?.body || '';
    }
    // Format 3: Direct simple payload
    else if (body.sender || body.from || body.phone) {
      senderPhone = body.sender || body.from || body.phone;
      incomingText = body.text || body.message || '';
      messageId = body.messageId || `${senderPhone}_${Date.now()}`;
    }

    // Ignore if no phone or message
    if (!senderPhone || !incomingText || incomingText.trim() === '') {
      console.log('[Webhook] Ignored: Non-text message or missing sender phone.');
      return;
    }

    // Deduplication check
    if (messageId && processedMessageIds.has(messageId)) {
      console.log(`[Webhook] Duplicate messageId ${messageId} ignored.`);
      return;
    }
    if (messageId) {
      processedMessageIds.add(messageId);
      // Clean up after 10 minutes
      setTimeout(() => processedMessageIds.delete(messageId), 10 * 60 * 1000);
    }

    console.log(`[Message Received] From: ${senderPhone} | Text: "${incomingText}"`);

    // Reset any pending follow-up since the user has replied!
    cancelFollowup(senderPhone);

    const session = getSession(senderPhone);

    // Call Gemini with user message and history
    const { replyText, leadData } = await generateGeminiReply(session.history, incomingText);

    // Update conversation history
    session.history.push({ role: 'user', text: incomingText });
    session.history.push({ role: 'model', text: replyText });
    session.lastUpdated = new Date();

    // Send AI reply back to user via Finbite WhatsApp API
    if (replyText) {
      await sendWhatsAppMessage(senderPhone, replyText);
    }

    // Process Lead Qualification
    if (leadData) {
      console.log(`[Lead Data Extracted for ${senderPhone}]:`, JSON.stringify(leadData));
      session.leadData = { ...session.leadData, ...leadData };

      // If lead is newly qualified, push to NeoDove
      if (leadData.is_qualified) {
        console.log(`🎉 [LEAD QUALIFIED] Pushing to CRM for ${senderPhone}...`);
        await pushLeadToNeoDove(session.leadData, senderPhone);
      }
    }

    // Schedule next smart follow-up if lead is not yet qualified
    scheduleFollowup(senderPhone, session.history, session.leadData);

  } catch (error) {
    console.error('[Webhook Processing Error]:', error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Diet Dekho WhatsApp Bot Server running on port ${PORT}`);
  console.log(`📍 Webhook URL path: /webhook`);
});
