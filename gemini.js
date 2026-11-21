const axios = require('axios');
const systemPrompt = require('./system_prompt');

/**
 * Call AI Engine for Diet Dekho WhatsApp Bot.
 * Prioritizes Groq (Llama 3.1 8B Instant) - available to 100% of free Groq accounts.
 * Includes automatic model cycling and error handling.
 * 
 * @param {Array<{role: string, text: string}>} history 
 * @param {string} userMessage 
 * @param {string|null} previousInteractionId
 * @returns {Promise<{replyText: string, leadData: object|null, interactionId: string|null}>}
 */
async function generateGeminiReply(history = [], userMessage = '', previousInteractionId = null) {
  const groqKey = process.env.GROQ_API_KEY;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!groqKey && !apiKey) {
    throw new Error('Neither GROQ_API_KEY nor GEMINI_API_KEY is configured in environment');
  }

  // 1. PRIMARY: Groq (Rock-solid, 0.3s latency, 100% active on all accounts)
  if (groqKey) {
    const groqModels = [
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'llama3-8b-8192',
      'mixtral-8x7b-32768'
    ];

    const messages = [{ role: 'system', content: systemPrompt }];
    for (const item of history) {
      messages.push({
        role: item.role === 'model' ? 'assistant' : 'user',
        content: item.text
      });
    }
    messages.push({ role: 'user', content: userMessage });

    for (const model of groqModels) {
      try {
        console.log(`[AI Engine] Trying Groq model: ${model}...`);
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: model,
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
          console.log(`[AI Engine] Groq Success with model: ${model}!`);
          return parseReply(rawReply, null);
        }
      } catch (err) {
        console.warn(`[AI Engine] Groq ${model} failed:`, err.response?.data?.error?.message || err.message);
      }
    }
  }

  // 2. SECONDARY: Google Gemini Interactions API (if Groq fails)
  if (apiKey) {
    try {
      console.log('[AI Engine] Trying Google Gemini Interactions API...');
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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
        timeout: 10000
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
        console.log('[AI Engine] Gemini Interactions Success!');
        return parseReply(rawReply, data.id);
      }
    } catch (err) {
      console.warn('[AI Engine] Gemini Interactions API failed:', err.response?.data?.error?.message || err.message);
    }
  }

  throw new Error('All configured AI providers (Groq models & Gemini) failed to generate a response.');
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
