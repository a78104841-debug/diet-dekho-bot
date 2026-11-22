const { generateGeminiReply } = require('./gemini');
const { sendWhatsAppMessage } = require('./whatsapp');

// In-memory store for active follow-up timers: { [phone]: TimeoutId }
const activeTimers = new Map();

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
 * If 2.5 hours from now falls in DND (night), delay until 09:30 AM IST tomorrow.
 * @returns {number} Delay in milliseconds
 */
function calculateFollowupDelayMs() {
  const now = new Date();
  const defaultDelayMs = 45 * 60 * 1000; // 45 minutes
  const targetDate = new Date(now.getTime() + defaultDelayMs);

  if (isWithinActiveHours(targetDate)) {
    return defaultDelayMs;
  }

  // Target falls during night DND! Calculate milliseconds until 09:30 AM IST next morning.
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
 * Cancel any pending follow-up for a phone number
 * @param {string} phone 
 */
function cancelFollowup(phone) {
  if (activeTimers.has(phone)) {
    clearTimeout(activeTimers.get(phone));
    activeTimers.delete(phone);
    console.log(`[Follow-up] Cleared pending timer for ${phone}`);
  }
}

/**
 * Schedule a smart follow-up message
 * @param {string} phone 
 * @param {Array<{role: string, text: string}>} history 
 * @param {object} lastLeadData 
 */
function scheduleFollowup(phone, history, lastLeadData) {
  // Cancel previous timer if any
  cancelFollowup(phone);

  // Guard: Do not follow-up if qualified, opted_out, or ed_concern
  if (lastLeadData?.is_qualified) {
    console.log(`[Follow-up] Skipping: Lead is already qualified for ${phone}`);
    return;
  }
  if (lastLeadData?.lead_stage === 'opted_out') {
    console.log(`[Follow-up] Skipping: User opted out for ${phone}`);
    return;
  }
  if (lastLeadData?.red_flags?.includes('ed_concern')) {
    console.log(`[Follow-up] Skipping: ED concern flagged for ${phone}`);
    return;
  }

  const delayMs = calculateFollowupDelayMs();

  const timerId = setTimeout(async () => {
    activeTimers.delete(phone);
    console.log(`[Follow-up Triggered] Executing smart follow-up for ${phone}...`);

    try {
      const followUpInstruction = `[SYSTEM NOTE: The user stopped responding. Generate a warm, gentle, context-aware follow-up message strictly adhering to Section 7 of the system prompt. Keep it 2 lines max.]`;
      
      const { replyText, leadData } = await generateGeminiReply(history, followUpInstruction);

      if (replyText) {
        await sendWhatsAppMessage(phone, replyText);
        // Save to history
        history.push({ role: 'user', text: followUpInstruction });
        history.push({ role: 'model', text: replyText });
      }
    } catch (err) {
      console.error(`[Follow-up Error] Failed to send follow-up to ${phone}:`, err.message);
    }
  }, delayMs);

  activeTimers.set(phone, timerId);
  console.log(`[Follow-up Scheduled] For ${phone} in ${(delayMs / 60000).toFixed(1)} minutes.`);
}

module.exports = {
  scheduleFollowup,
  cancelFollowup
};
