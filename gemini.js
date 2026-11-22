const axios = require('axios');
const systemPrompt = require('./system_prompt');

/**
 * Call AI Engine for Diet Dekho WhatsApp Bot.
 * Prioritizes Groq (openai/gpt-oss-20b) with known lead context injection.
 * 
 * @param {Array<{role: string, text: string}>} history 
 * @param {string} userMessage 
 * @param {object|null} existingLeadData
 * @param {string|null} previousInteractionId
 * @returns {Promise<{replyText: string, leadData: object|null, interactionId: string|null}>}
 */
async function generateGeminiReply(history = [], userMessage = '', existingLeadData = null, previousInteractionId = null) {
  const groqKey = process.env.GROQ_API_KEY;
  const apiKey = process.env.GEMINI_API_KEY;

  const groqModels = [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'qwen/qwen3.8-27b'
  ];

  let dynamicSystemPrompt = systemPrompt;
  if (existingLeadData && Object.keys(existingLeadData).length > 0) {
    const knownFields = Object.entries(existingLeadData)
      .filter(([_, v]) => v !== null && v !== '' && (!Array.isArray(v) || v.length > 0))
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ');

    if (knownFields) {
      dynamicSystemPrompt += `\n\n## CURRENT LEAD MEMORY (ALREADY COLLECTED - NEVER RE-ASK)\nThe user has already shared: [ ${knownFields} ].\n- DO NOT ask for any of these details again.\n- If preferred_call_time is already scheduled, DO NOT repeat the call confirmation line at the end of your answer.`;
    }
  }

  const messages = [{ role: 'system', content: dynamicSystemPrompt }];
  for (const item of history) {
    messages.push({
      role: item.role === 'model' ? 'assistant' : 'user',
      content: item.text
    });
  }
  messages.push({ role: 'user', content: userMessage });

  // 1. PRIMARY: Groq (0.4s instant execution)
  if (groqKey) {
    for (const model of groqModels) {
      try {
        console.log(`[AI Engine] Calling Groq model: ${model}...`);
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: model,
          messages: messages,
          temperature: 0.5,
          max_tokens: 1500
        }, {
          headers: {
            'Authorization': `Bearer ${groqKey.trim()}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
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

  // 2. SECONDARY: Google Gemini Interactions API (Backup)
  if (apiKey) {
    try {
      console.log('[AI Engine] Trying Google Gemini Interactions API...');
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      const interactionsUrl = 'https://generativelanguage.googleapis.com/v1beta/interactions';
      
      const payload = {
        model: model,
        system_instruction: dynamicSystemPrompt,
        input: userMessage
      };

      if (previousInteractionId) {
        payload.previous_interaction_id = previousInteractionId;
      }

      const response = await axios.post(interactionsUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim()
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

  throw new Error('All configured AI models on Groq and Gemini failed.');
}

function parseReply(rawReply, interactionId = null) {
  let leadData = null;
  const jsonMatch = rawReply.match(/<lead_data>([\s\S]*?)(?:<\/lead_data>|$)/i);

  if (jsonMatch && jsonMatch[1]) {
    try {
      // Find the first { and last }
      const content = jsonMatch[1].trim();
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        leadData = JSON.parse(content.substring(start, end + 1));
      }
    } catch (err) {
      console.error('Failed to parse <lead_data> JSON:', err.message);
    }
  }

  const cleanReplyText = rawReply.replace(/<lead_data>[\s\S]*?(?:<\/lead_data>|$)/gi, '').trim();

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
