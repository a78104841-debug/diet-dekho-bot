const axios = require('axios');
const systemPrompt = require('./system_prompt');

/**
 * Call Gemini API using modern Interactions API (preferred for gemini-3.8-flash)
 * with automatic fallback to generateContent and Groq if configured.
 * 
 * @param {Array<{role: string, text: string}>} history 
 * @param {string} userMessage 
 * @param {string|null} previousInteractionId
 * @returns {Promise<{replyText: string, leadData: object|null, interactionId: string|null}>}
 */
async function generateGeminiReply(history = [], userMessage = '', previousInteractionId = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!apiKey && !groqKey) {
    throw new Error('Neither GEMINI_API_KEY nor GROQ_API_KEY is configured in environment');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  // 1. Try Google Gemini Interactions API (Recommended for Gemini 3.8 Flash)
  if (apiKey) {
    try {
      console.log(`[AI Engine] Calling Google Interactions API with model: ${model}...`);
      const interactionsUrl = 'https://generativelanguage.googleapis.com/v1beta/interactions';
      
      const payload = {
        model: model,
        system_instruction: systemPrompt,
        input: userMessage
      };

      if (previousInteractionId) {
        payload.previous_interaction_id = previousInteractionId;
      }

      const response = await axios.post(interactionsUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        timeout: 15000
      });

      const data = response.data;
      let rawReply = data.output_text || '';

      if (!rawReply && data.steps) {
        for (const step of data.steps) {
          if (step.type === 'model_output' && step.content) {
            for (const item of step.content) {
              if (item.text) rawReply += item.text;
            }
          }
        }
      }

      if (rawReply) {
        return parseReply(rawReply, data.id);
      }
    } catch (err) {
      console.warn('[AI Engine] Interactions API failed:', err.response?.data?.error?.message || err.message);
    }

    // 2. Fallback: Classic generateContent API with gemini-2.0-flash / gemini-2.5-flash-lite
    try {
      console.log('[AI Engine] Falling back to generateContent API...');
      const fallbackModel = 'gemini-2.5-flash-lite';
      const classicUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`;

      const contents = history.map(item => ({
        role: item.role === 'model' ? 'model' : 'user',
        parts: [{ text: item.text }]
      }));
      contents.push({ role: 'user', parts: [{ text: userMessage }] });

      const response = await axios.post(classicUrl, {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 1000 }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });

      const rawReply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (rawReply) {
        return parseReply(rawReply, null);
      }
    } catch (err) {
      console.warn('[AI Engine] generateContent fallback failed:', err.response?.data?.error?.message || err.message);
    }
  }

  // 3. Fallback: Groq Cloud (Llama 3.3 70B - 100% Free, 0.5s Latency) if GROQ_API_KEY is provided
  if (groqKey) {
    try {
      console.log('[AI Engine] Falling back to Groq Llama 3.3 70B...');
      const messages = [{ role: 'system', content: systemPrompt }];
      for (const item of history) {
        messages.push({ role: item.role === 'model' ? 'assistant' : 'user', content: item.text });
      }
      messages.push({ role: 'user', content: userMessage });

      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.6,
        max_tokens: 1000
      }, {
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const rawReply = response.data?.choices?.[0]?.message?.content || '';
      if (rawReply) {
        return parseReply(rawReply, null);
      }
    } catch (err) {
      console.error('[AI Engine] Groq fallback failed:', err.response?.data || err.message);
    }
  }

  throw new Error('All AI providers (Interactions API, generateContent, Groq) failed to generate a response.');
}

function parseReply(rawReply, interactionId = null) {
  let leadData = null;
  const jsonMatch = rawReply.match(/<lead_data>([\s\S]*?)<\/lead_data>/i);

  if (jsonMatch && jsonMatch[1]) {
    try {
      leadData = JSON.parse(jsonMatch[1].trim());
    } catch (err) {
      console.error('Failed to parse <lead_data> JSON:', err.message);
    }
  }

  const cleanReplyText = rawReply.replace(/<lead_data>[\s\S]*?<\/lead_data>/gi, '').trim();

  return {
    replyText: cleanReplyText,
    leadData: leadData,
    interactionId: interactionId,
    rawReply: rawReply
  };
}

module.exports = {
  generateGeminiReply
};
