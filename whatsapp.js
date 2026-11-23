const axios = require('axios');

/**
 * Send a WhatsApp text message via Finbite API
 * @param {string} to Recipient phone number with country code (e.g. "919876543210")
 * @param {string} text Message content
 * @returns {Promise<object>}
 */
async function sendWhatsAppMessage(to, text) {
  const apiKey = process.env.FINBITE_API_KEY;
  const phoneNoId = process.env.FINBITE_PHONE_ID;
  const baseUrl = process.env.FINBITE_BASE_URL || 'https://automate.finbite.in/api';

  if (!apiKey || !phoneNoId) {
    throw new Error('FINBITE_API_KEY or FINBITE_PHONE_ID is missing in environment variables');
  }

  // Clean the recipient phone number (remove +, spaces, hyphens)
  const cleanTo = String(to).replace(/[^0-9]/g, '');

  const url = `${baseUrl}/v2/whatsapp-business/messages`;

  const payload = {
    to: cleanTo,
    phoneNoId: String(phoneNoId),
    type: 'text',
    text: text
  };

  try {
    console.log(`[WhatsApp Outbound] Sending message to ${cleanTo}...`);
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log(`[WhatsApp Outbound Success] To: ${cleanTo}, Status: ${response.status}`);
    return response.data;
  } catch (error) {
    const errorData = error.response?.data || error.message;
    console.error(`[WhatsApp Outbound Error] To: ${cleanTo}`, errorData);
    throw new Error(`Finbite WhatsApp API Error: ${JSON.stringify(errorData)}`);
  }
}

/**
 * Send a WhatsApp image message with optional caption via Finbite API
 * @param {string} to Recipient phone number with country code
 * @param {string} imageUrl Publicly accessible image URL (HTTPS)
 * @param {string} caption Optional caption text
 * @returns {Promise<object>}
 */
async function sendWhatsAppImage(to, imageUrl, caption = '') {
  const apiKey = process.env.FINBITE_API_KEY;
  const phoneNoId = process.env.FINBITE_PHONE_ID;
  const baseUrl = process.env.FINBITE_BASE_URL || 'https://automate.finbite.in/api';

  if (!apiKey || !phoneNoId) {
    throw new Error('FINBITE_API_KEY or FINBITE_PHONE_ID is missing in environment variables');
  }

  const cleanTo = String(to).replace(/[^0-9]/g, '');
  const url = `${baseUrl}/v2/whatsapp-business/messages`;

  const payload = {
    to: cleanTo,
    phoneNoId: String(phoneNoId),
    type: 'image',
    url: imageUrl,
    caption: caption
  };

  try {
    console.log(`[WhatsApp Outbound Image] Sending image to ${cleanTo}: ${imageUrl}...`);
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log(`[WhatsApp Outbound Image Success] To: ${cleanTo}, Status: ${response.status}`);
    return response.data;
  } catch (error) {
    const errorData = error.response?.data || error.message;
    console.error(`[WhatsApp Outbound Image Error] To: ${cleanTo}`, errorData);
    // Reliable Fallback: If image fails, deliver caption as normal text so the lead is never dropped
    if (caption) {
      console.log(`[WhatsApp Fallback] Sending caption as text to ${cleanTo}...`);
      return sendWhatsAppMessage(cleanTo, caption);
    }
    throw new Error(`Finbite WhatsApp Image Error: ${JSON.stringify(errorData)}`);
  }
}

module.exports = {
  sendWhatsAppMessage,
  sendWhatsAppImage
};
