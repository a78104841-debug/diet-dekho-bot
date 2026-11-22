const axios = require('axios');
const { generateGeminiReply } = require('./gemini');
const { sendWhatsAppMessage } = require('./whatsapp');

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
  if (session.leadData?.preferred_call_time && String(session.leadData.preferred_call_time).trim() !== '') {
    console.log(`[Follow-up] Skipping: Call already booked for ${phone} at "${session.leadData.preferred_call_time}"`);
    session.followupPending = false;
    return;
  }

  // Skip if customer explicitly opted out
  if (session.leadData?.lead_stage === 'opted_out') {
    console.log(`[Follow-up] Skipping: User opted out for ${phone}`);
    session.followupPending = false;
    return;
  }

  // Max 2 follow-ups
  if ((session.followupCount || 0) >= 2) {
    console.log(`[Follow-up] Skipping: Max follow-ups (2) already sent for ${phone}`);
    session.followupPending = false;
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
    if (session.leadData?.preferred_call_time && String(session.leadData.preferred_call_time).trim() !== '') {
      session.followupPending = false;
      continue;
    }

    if (session.leadData?.lead_stage === 'opted_out' || (session.followupCount || 0) >= 2) {
      session.followupPending = false;
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

      try {
        const followUpInstruction = `[SYSTEM NOTE: The user stopped responding. Generate a warm, gentle, context-aware follow-up message strictly adhering to Section 7 of the system prompt. Ask for the missing detail (e.g. call time between 10:00 AM and 6:30 PM, or health goal). Keep it 2 lines max.]`;

        const { replyText } = await generateGeminiReply(
          session.history,
          followUpInstruction,
          session.leadData,
          session.interactionId
        );

        if (replyText) {
          await sendWhatsAppMessage(phone, replyText);
          session.history.push({ role: 'user', text: followUpInstruction });
          session.history.push({ role: 'model', text: replyText });
          if (session.history.length > 20) session.history = session.history.slice(-20);
          console.log(`✅ [Follow-up Delivered] Sent to ${phone}: "${replyText.substring(0, 80)}..."`);
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
