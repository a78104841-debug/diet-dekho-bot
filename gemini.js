const axios = require('axios');
const systemPrompt = require('./system_prompt');

/**
 * Call Gemini API with conversation history and extract clean text + lead JSON
 * @param {Array<{role: string, text: string}>} history 
 * @param {string} userMessage 
 * @returns {Promise<{replyText: string, leadData: object|null}>}
 */
async function generateGeminiReply(history = [], userMessage = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined in environment variables');
  }

  // Model choice: gemini-2.5-flash (or 1.5-flash / 2.0-flash)
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build contents array for Gemini
  const contents = [];

  for (const item of history) {
    contents.push({
      role: item.role === 'model' ? 'model' : 'user',
      parts: [{ text: item.text }]
    });
  }

  // Add the current user message
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 1000
    }
  };

  try {
    const response = await axios.post(url, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const candidate = response.data?.candidates?.[0];
    const rawReply = candidate?.content?.parts?.[0]?.text || '';

    // Extract <lead_data> JSON block
    let leadData = null;
    const jsonMatch = rawReply.match(/<lead_data>([\s\S]*?)<\/lead_data>/i);

    if (jsonMatch && jsonMatch[1]) {
      try {
        leadData = JSON.parse(jsonMatch[1].trim());
      } catch (err) {
        console.error('Failed to parse <lead_data> JSON from Gemini:', err.message);
      }
    }

    // Clean reply text (remove the <lead_data> block before sending to WhatsApp)
    const cleanReplyText = rawReply.replace(/<lead_data>[\s\S]*?<\/lead_data>/gi, '').trim();

    return {
      replyText: cleanReplyText,
      leadData: leadData,
      rawReply: rawReply
    };
  } catch (error) {
    const errorDetails = error.response?.data || error.message;
    console.error('Gemini API Error:', errorDetails);
    throw new Error(`Gemini API Error: ${JSON.stringify(errorDetails)}`);
  }
}

module.exports = {
  generateGeminiReply
};
