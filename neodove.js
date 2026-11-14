const axios = require('axios');

/**
 * Send qualified lead to NeoDove CRM
 * @param {object} leadData 
 * @param {string} phone 
 * @returns {Promise<boolean>}
 */
async function pushLeadToNeoDove(leadData, phone) {
  const neodoveUrl = process.env.NEODOVE_WEBHOOK_URL;

  if (!neodoveUrl || neodoveUrl.trim() === '' || neodoveUrl.includes('placeholder')) {
    console.log(`[NeoDove Notice] NEODOVE_WEBHOOK_URL is not set yet. Skipping CRM push for phone: ${phone}.`);
    return false;
  }

  // Format payload according to NeoDove Custom Inbound Webhook standards
  const payload = {
    name: leadData.name || 'WhatsApp Lead',
    mobile: String(phone).replace(/[^0-9]/g, ''),
    city: leadData.city || '',
    source: 'WhatsApp AI (Diet Dekho)',
    goal: leadData.goal || '',
    medical_conditions: leadData.medical_conditions || 'None',
    height: leadData.height || '',
    current_weight: leadData.current_weight || '',
    target_weight: leadData.target_weight || '',
    bmi: leadData.bmi || '',
    preferred_call_time: leadData.preferred_call_time || '',
    red_flags: Array.isArray(leadData.red_flags) ? leadData.red_flags.join(', ') : '',
    lead_stage: leadData.lead_stage || 'qualified',
    timestamp: new Date().toISOString()
  };

  try {
    console.log(`[NeoDove] Pushing qualified lead to CRM for ${phone}...`);
    const response = await axios.post(neodoveUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    console.log(`[NeoDove Success] Lead successfully pushed! Status: ${response.status}`);
    return true;
  } catch (error) {
    console.error(`[NeoDove Error] Failed to push lead:`, error.response?.data || error.message);
    return false;
  }
}

module.exports = {
  pushLeadToNeoDove
};
