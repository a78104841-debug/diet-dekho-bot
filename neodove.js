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

  // Value preparation matching NeoDove exact CRM custom field types
  const ageVal = leadData.age ? (parseInt(leadData.age, 10) || leadData.age) : null;
  const weightVal = leadData.current_weight 
    ? (parseFloat(String(leadData.current_weight).replace(/[^0-9.]/g, '')) || leadData.current_weight) 
    : null;
  const heightVal = leadData.height ? String(leadData.height) : null;
  const medicalVal = leadData.medical_conditions || 'None';
  const paidComfortable = leadData.is_paid_comfortable !== undefined ? Boolean(leadData.is_paid_comfortable) : null;
  const bmiVal = leadData.bmi ? (parseFloat(leadData.bmi) || leadData.bmi) : null;
  const timelineVal = leadData.start_timeline ? String(leadData.start_timeline) : null;
  const callTimeVal = leadData.preferred_call_time || null;
  const goalVal = leadData.goal || 'Weight Loss';
  const isQualified = Boolean(leadData.is_qualified || leadData.preferred_call_time);

  const payload = {
    name: displayName,
    mobile: mobileNum,
    city: leadData.city || '',
    source: 'WhatsApp Assistant (Diet Dekho)',
    goal: goalVal,
    "Goal": goalVal,

    // Exact NeoDove Custom CRM Column mappings (Case-Sensitive & Special Characters)
    "Age": ageVal,
    age: ageVal,

    "Weight": weightVal,
    current_weight: weightVal,

    "Height": heightVal,
    height: heightVal,

    "Medical Condition": medicalVal,
    "Medical Conditions": medicalVal,
    medical_conditions: medicalVal,

    "Are you okay with Paid Plans?": paidComfortable,
    is_paid_comfortable: paidComfortable,

    "start_timeline": timelineVal,
    "Start Timeline": timelineVal,

    "bmi": bmiVal,
    "BMI": bmiVal,

    "preferred_call_time": callTimeVal,
    "Preferred Call Time": callTimeVal,

    "Target Weight": leadData.target_weight ? String(leadData.target_weight) : '',
    target_weight: leadData.target_weight ? String(leadData.target_weight) : '',

    "City": leadData.city || '',
    "Source": 'WhatsApp Assistant (Diet Dekho)',

    "Lead Temperature": isFresh ? 'warm' : (leadData.lead_temperature || 'hot'),
    lead_temperature: isFresh ? 'warm' : (leadData.lead_temperature || 'hot'),

    "Lead Stage": isFresh ? 'fresh_lead' : (leadData.lead_stage || (callTimeVal ? 'appointment_booked' : 'qualified')),
    lead_stage: isFresh ? 'fresh_lead' : (leadData.lead_stage || (callTimeVal ? 'appointment_booked' : 'qualified')),

    "Is Qualified": isQualified,
    is_qualified: isQualified,

    "Summary": leadData.summary || (isFresh ? 'Fresh WhatsApp broadcast reply - qualification in progress' : `Goal: ${goalVal}, Age: ${ageVal || 'N/A'}, Weight: ${weightVal || 'N/A'}, Height: ${heightVal || 'N/A'}, Call: ${callTimeVal || 'Pending'}, Paid: ${paidComfortable ? 'Yes' : 'No'}`),
    summary: leadData.summary || (isFresh ? 'Fresh WhatsApp broadcast reply - qualification in progress' : `Goal: ${goalVal}, Age: ${ageVal || 'N/A'}, Weight: ${weightVal || 'N/A'}, Height: ${heightVal || 'N/A'}, Call: ${callTimeVal || 'Pending'}, Paid: ${paidComfortable ? 'Yes' : 'No'}`),

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
