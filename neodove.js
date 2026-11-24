const axios = require('axios');

// NeoDove Inbound Webhook Endpoints
const NEODOVE_CREATE_URL = process.env.NEODOVE_WEBHOOK_URL || 'https://e3f2413e-dc54-46d6-bf04-020fa80bcc8e.neodove.com/integration/custom/01377a06-9add-420b-acde-ee5fc6b46bf3/leads';
const NEODOVE_UPDATE_URL = NEODOVE_CREATE_URL.includes('?')
  ? `${NEODOVE_CREATE_URL}&update=true`
  : `${NEODOVE_CREATE_URL}?update=true`;

/**
 * Send or update qualified lead in NeoDove CRM
 * @param {object} leadData 
 * @param {string} phone 
 * @param {boolean} isUpdate 
 * @returns {Promise<boolean>}
 */
async function pushLeadToNeoDove(leadData = {}, phone, isUpdate = false) {
  const url = isUpdate ? NEODOVE_UPDATE_URL : NEODOVE_CREATE_URL;

  // Clean 10-digit mobile number for Indian format
  let rawDigits = String(phone).replace(/[^0-9]/g, '');
  if (rawDigits.length === 12 && rawDigits.startsWith('91')) {
    rawDigits = rawDigits.substring(2);
  }
  const mobileNum = Number(rawDigits) || rawDigits;

  const isFresh = !isUpdate && !leadData.is_qualified && !leadData.preferred_call_time;

  // Name Resolution Order:
  // 1. Confirmed name given by user in chat (leadData.name)
  // 2. Finbite senderName (leadData.finbiteName)
  // 3. Fallback: "Lead <last 4 digits>" (never generic "WhatsApp Fresh Lead")
  let displayName = leadData.name;
  if (!displayName || displayName === 'WhatsApp Fresh Lead' || displayName === 'WhatsApp Lead') {
    displayName = leadData.finbiteName || `Lead ${String(mobileNum).slice(-4)}`;
  }

  const payload = {
    name: displayName,
    mobile: mobileNum,
    city: leadData.city || '',
    source: 'WhatsApp Assistant (Diet Dekho)',
    goal: leadData.goal || 'Weight Loss',
    age: leadData.age ? String(leadData.age) : '',
    medical_conditions: leadData.medical_conditions || 'None',
    height: leadData.height ? String(leadData.height) : '',
    current_weight: leadData.current_weight ? String(leadData.current_weight) : '',
    target_weight: leadData.target_weight ? String(leadData.target_weight) : '',
    bmi: leadData.bmi ? String(leadData.bmi) : '',
    start_timeline: leadData.start_timeline ? String(leadData.start_timeline) : '',
    preferred_call_time: leadData.preferred_call_time || '',
    is_paid_comfortable: leadData.is_paid_comfortable !== undefined ? leadData.is_paid_comfortable : null,
    lead_temperature: isFresh ? 'warm' : (leadData.lead_temperature || 'hot'),
    summary: leadData.summary || (isFresh ? 'Fresh WhatsApp broadcast reply - qualification in progress' : `Goal: ${leadData.goal || 'Weight Loss'}, Age: ${leadData.age || 'N/A'}, Start: ${leadData.start_timeline || 'N/A'}, Call: ${leadData.preferred_call_time || 'Pending'}, Paid: ${leadData.is_paid_comfortable ? 'Yes' : 'No'}`),
    lead_stage: isFresh ? 'fresh_lead' : (leadData.lead_stage || (leadData.preferred_call_time ? 'appointment_booked' : 'qualified')),
    timestamp: new Date().toISOString()
  };

  try {
    console.log(`[NeoDove] Pushing lead (${isUpdate ? 'UPDATE' : 'CREATE'}) to CRM for ${mobileNum} (${displayName})...`);
    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    console.log(`[NeoDove Success] Lead ${isUpdate ? 'updated' : 'created'}! Status: ${response.status}`);
    return true;
  } catch (error) {
    console.error(`[NeoDove Error] Failed to ${isUpdate ? 'update' : 'create'} lead:`, error.response?.data || error.message);
    return false;
  }
}

module.exports = {
  pushLeadToNeoDove
};
