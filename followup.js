const axios = require('axios');
const { generateGeminiReply } = require('./gemini');
const { sendWhatsAppMessage, sendWhatsAppImage } = require('./whatsapp');
const { stripEmojis } = require('./utils');

// 5 Curated, high-converting client transformation photos (~100 KB each)
const TRANSFORMATION_PHOTOS = [
  { file: 'transform_14kg.jpg', hook: '14 kg वज़न 3 महीने में घर के खाने से घटाया' },
  { file: 'transform_12kg.jpg', hook: '12 kg वज़न 3 महीने में घटाया' },
  { file: 'transform_19kg.jpg', hook: '19 kg वज़न 3 महीने में कम किया' },
  { file: 'transform_22kg.jpg', hook: '22 kg का अद्भुत ट्रांसफॉर्मेशन' },
  { file: 'transform_6kg.jpg', hook: '6 kg वज़न और बेहतरीन इंच लॉस किया' }
];

/**
 * Check if current time in IST is within active hours (09:00 AM to 09:30 PM)
 * @param {Date} date 
 * @returns {boolean}
 */
function isWithinActiveHours(date = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  // 09:00 AM = 540 min, 09:30 PM (21:30) = 1290 min
  return totalMinutes >= 540 && totalMinutes <= 1290;
}

/**
 * Calculate delay in milliseconds until a safe follow-up time.
 * If 45 mins from now falls in DND (night), delay until 09:30 AM IST tomorrow.
 * @returns {number} Delay in milliseconds
 */
function calculateFollowupDelayMs() {
  const now = new Date();
  const defaultDelayMs = 45 * 60 * 1000; // 45 minutes
  const targetDate = new Date(now.getTime() + defaultDelayMs);

  if (isWithinActiveHours(targetDate)) {
    return defaultDelayMs;
  }

  // Target falls during night DND! Postpone to 09:30 AM IST next morning.
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  
  const istTomorrow = new Date(istNow);
  istTomorrow.setUTCDate(istTomorrow.getUTCDate() + 1);
  istTomorrow.setUTCHours(9, 30, 0, 0); // 09:30 AM IST

  const delayMs = istTomorrow.getTime() - istNow.getTime();
  console.log(`[Follow-up Scheduler] Target falls in DND night window. Postponed to next morning 09:30 AM IST (${Math.round(delayMs / 60000)} mins from now).`);
  return delayMs;
}

/**
 * Cancel pending follow-up when user replies
 */
function cancelFollowup(phone, session, saveSessionsToDisk) {
  if (session) {
    session.followupPending = false;
    session.followupDueAt = null;
    session.followupCount = 0; // Reset count on active reply
    if (saveSessionsToDisk) saveSessionsToDisk();
    console.log(`[Follow-up] Cancelled pending follow-up for ${phone}`);
  }
}

/**
 * Schedule a follow-up for a session
 */
function scheduleFollowup(phone, session, saveSessionsToDisk) {
  if (!session) return;

  // STRICT RULE: Only stop follow-ups if preferred_call_time is ALREADY booked!
  if ((session.leadData?.preferred_call_time && String(session.leadData.preferred_call_time).trim() !== '') || session.leadData?.lead_stage === 'appointment_booked') {
    console.log(`[Follow-up] Skipping: Call already booked for ${phone}`);
    session.followupPending = false;
    session.followupDueAt = null;
    return;
  }

  // Skip and kill if customer explicitly opted out, not interested, or unqualified
  const isUnqualifiedOrRejected = ['opted_out', 'not_interested', 'unqualified', 'disqualified'].includes(session.leadData?.lead_stage) ||
                                  session.leadData?.is_paid_comfortable === false;

  if (isUnqualifiedOrRejected) {
    console.log(`[Follow-up] Skipping & Cancelling: Lead is disqualified/not interested for ${phone}`);
    session.followupPending = false;
    session.followupDueAt = null;
    if (saveSessionsToDisk) saveSessionsToDisk();
    return;
  }

  // Max 2 follow-ups
  if ((session.followupCount || 0) >= 2) {
    console.log(`[Follow-up] Skipping: Max follow-ups (2) already sent for ${phone}`);
    session.followupPending = false;
    session.followupDueAt = null;
    return;
  }

  const delayMs = calculateFollowupDelayMs();
  session.followupPending = true;
  session.followupDueAt = Date.now() + delayMs;
  if (saveSessionsToDisk) saveSessionsToDisk();

  console.log(`[Follow-up Scheduled] For ${phone} in ${(delayMs / 60000).toFixed(1)} mins (Due at: ${new Date(session.followupDueAt).toISOString()})`);
}

/**
 * Check and execute any due follow-ups across all sessions
 */
async function checkAndExecuteDueFollowups(sessions, saveSessionsToDisk) {
  if (!sessions) return;
  const now = Date.now();

  for (const [phone, session] of sessions.entries()) {
    if (!session.followupPending || !session.followupDueAt) continue;

    // If call already booked in meantime, cancel
    if ((session.leadData?.preferred_call_time && String(session.leadData.preferred_call_time).trim() !== '') || session.leadData?.lead_stage === 'appointment_booked') {
      session.followupPending = false;
      session.followupDueAt = null;
      continue;
    }

    const isUnqualifiedOrRejected = ['opted_out', 'not_interested', 'unqualified', 'disqualified'].includes(session.leadData?.lead_stage) ||
                                    session.leadData?.is_paid_comfortable === false ||
                                    (session.followupCount || 0) >= 2;

    if (isUnqualifiedOrRejected) {
      session.followupPending = false;
      session.followupDueAt = null;
      if (saveSessionsToDisk) saveSessionsToDisk();
      continue;
    }

    // Is the follow-up due?
    if (now >= session.followupDueAt) {
      // Check active hours
      if (!isWithinActiveHours(new Date())) {
        console.log(`[Follow-up Check] Time is in night DND for ${phone}. Postponing to next morning 09:30 AM.`);
        session.followupDueAt = now + calculateFollowupDelayMs();
        if (saveSessionsToDisk) saveSessionsToDisk();
        continue;
      }

      console.log(`🔔 [Follow-up Triggered] Executing smart follow-up for ${phone}...`);
      session.followupPending = false;
      session.followupCount = (session.followupCount || 0) + 1;

      // STRICT RULE: Photo is ONLY sent as an initial icebreaker when customer ghosted at Step 1 (awaiting height/weight).
      // Once details/chat are active or scheduling a call, send pure human text (NO marketing photo spam).
      const isAwaitingHeightWeight = !session.leadData?.current_weight && !session.leadData?.height;
      const shouldSendPhoto = isAwaitingHeightWeight && session.followupCount === 1;

      try {
        let followUpInstruction;
        let selectedPhoto = null;
        let imageUrl = null;

        if (shouldSendPhoto) {
          const photoIndex = 0; // transform_14kg.jpg (14kg in 3 months matches 15kg campaign)
          selectedPhoto = TRANSFORMATION_PHOTOS[photoIndex];
          const botHost = process.env.BASE_URL || 'https://diet-dekho-bot.onrender.com';
          imageUrl = `${botHost}/media/${selectedPhoto.file}`;
          followUpInstruction = `[CRITICAL SYSTEM DIRECTIVE:
1. UNDER NO CIRCUMSTANCES CONGRATULATE THE USER/PROSPECT. The attached photo shows a past Diet Dekho client who achieved this transformation, NOT the user! The user is overweight and still trying to lose weight!
2. Absolutely DO NOT say words like "बधाई", "congratulations", "शानदार बदलाव आपका", "आपका ट्रांसफॉर्मेशन", "आपका परिवर्तन", or imply this is their achievement.
3. Write a warm 2-line WhatsApp caption presenting this client's success as motivation:
"देखिए हमारे एक क्लाइंट ने घर के सादे खाने से 3 महीने में 14 kg वज़न घटाया। आपका 15 kg वेट लॉस असेसमेंट तैयार करने के लिए बस आपकी उम्र, वर्तमान वज़न और हाइट बता दीजिए।"
4. Keep it under 2 lines, friendly Hindi/Hinglish, zero emojis, zero tech talk.]`;
        } else {
          // Warm, personal 1-on-1 human dietitian text message
          followUpInstruction = `[SYSTEM NOTE: The user paused the conversation. Write a warm, friendly, natural 1-on-1 human message (like a caring nutritionist assistant on WhatsApp). Pick up naturally based on last context (e.g. asking for call slot between 10 AM to 6:30 PM). Keep it short (2 lines), zero emojis, polite and personal. DO NOT pitch or sell aggressively.]`;
        }

        const { replyText } = await generateGeminiReply(
          session.history,
          followUpInstruction,
          session.leadData,
          session.interactionId
        );

        if (replyText) {
          let sanitizedReply = replyText;
          if (shouldSendPhoto) {
            // Unbreakable safety filter against congratulating prospect on transformation photo
            const forbiddenPhrases = [
              'बधाई', 'congratulat', 'शानदार बदलाव आपका', 'आपका ट्रांसफॉर्मेशन',
              'आपका परिवर्तन देखकर', 'आपका यह ट्रांसफॉर्मेशन', 'आपका ये ट्रांसफॉर्मेशन',
              'आपका वजन कम होना सच में प्रेरणादायक', 'आपका अद्भुत बदलाव', 'आपकी मेहनत रंग लाई',
              'आपका ये बदलाव'
            ];
            const hasCongratulation = forbiddenPhrases.some(phrase => sanitizedReply.toLowerCase().includes(phrase));
            if (hasCongratulation) {
              console.warn(`⚠️ [Follow-up Safety Filter Triggered] AI generated congratulatory text for prospect. Replacing with safe client showcase caption.`);
              sanitizedReply = `देखिए हमारे एक क्लाइंट ने घर के सादे खाने से 3 महीने में 14 kg वज़न घटाया।\n\nआपका 15 kg वेट लॉस असेसमेंट तैयार करने के लिए बस आपकी उम्र, वर्तमान वज़न और हाइट बता दीजिए!`;
            }
          }

          // Strict Zero Emoji Filter on all outbound messages
          sanitizedReply = stripEmojis(sanitizedReply);

          if (shouldSendPhoto && imageUrl) {
            await sendWhatsAppImage(phone, imageUrl, sanitizedReply);
            console.log(`✅ [Follow-up Delivered with Photo] Sent to ${phone}: ${imageUrl} | "${sanitizedReply.substring(0, 80)}..."`);
          } else {
            await sendWhatsAppMessage(phone, sanitizedReply);
            console.log(`✅ [Follow-up Delivered as Clean Text] Sent to ${phone}: "${sanitizedReply.substring(0, 80)}..."`);
          }

          session.history.push({ role: 'user', text: followUpInstruction });
          session.history.push({ role: 'model', text: sanitizedReply });
          if (session.history.length > 20) session.history = session.history.slice(-20);
        }

        // If this was follow-up 1, schedule follow-up 2 for tomorrow morning / 12 hours later
        if (session.followupCount < 2) {
          session.followupPending = true;
          session.followupDueAt = now + (12 * 60 * 60 * 1000);
        }

        if (saveSessionsToDisk) saveSessionsToDisk();
      } catch (err) {
        console.error(`[Follow-up Error] Failed to execute follow-up for ${phone}:`, err.message);
      }
    }
  }
}

module.exports = {
  scheduleFollowup,
  cancelFollowup,
  checkAndExecuteDueFollowups,
  isWithinActiveHours,
  calculateFollowupDelayMs
};
