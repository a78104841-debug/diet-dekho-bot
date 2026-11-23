const axios = require('axios');
const systemPrompt = require('./system_prompt');

/**
 * Call AI Engine for Diet Dekho WhatsApp Bot.
 * Strips all JSON metadata rigorously so it NEVER leaks to WhatsApp.
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
      dynamicSystemPrompt += `\n\n## CURRENT KNOWN LEAD DATA (DO NOT ASK FOR THESE AGAIN)\n[ ${knownFields} ]\n- If a detail above is already known, NEVER ask for it again.\n- If user asks a question, answer their question FIRST. Never ignore their question.`;
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
          temperature: 0.4,
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
        const errMsg = err.response?.data?.error?.message || err.message;
        console.warn(`[AI Engine] Groq ${model} failed:`, errMsg);
        // If rate limited, pause 1.5s before fallback model
        if (err.response?.status === 429 || errMsg.includes('Rate limit')) {
          await new Promise(r => setTimeout(r, 1500));
        }
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

/**
 * Parse reply and strictly strip ANY JSON block from the text sent to WhatsApp
 */
function parseReply(rawReply, interactionId = null) {
  let leadData = null;
  let cleanReplyText = rawReply;

  // 1. Look for <lead_data> tag
  const tagMatch = rawReply.match(/<lead_data>([\s\S]*?)(?:<\/lead_data>|$)/i);
  if (tagMatch) {
    try {
      const content = tagMatch[1].trim();
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        leadData = JSON.parse(content.substring(start, end + 1));
      }
    } catch (e) {}
    cleanReplyText = cleanReplyText.replace(/<lead_data>[\s\S]*?(?:<\/lead_data>|$)/gi, '').trim();
  }

  // 2. Also strip any raw JSON object { ... "is_qualified" ... } or markdown codeblock { ... }
  const jsonPattern = /\n*```(?:json)?\s*(\{[\s\S]*?\})\s*```|\n*(\{[\s\S]*?"(?:name|goal|is_qualified|lead_stage)"[\s\S]*?\})/i;
  const rawJsonMatch = cleanReplyText.match(jsonPattern);
  if (rawJsonMatch) {
    try {
      const jsonStr = (rawJsonMatch[1] || rawJsonMatch[2]).trim();
      if (!leadData) {
        leadData = JSON.parse(jsonStr);
      }
    } catch (e) {}
    cleanReplyText = cleanReplyText.replace(jsonPattern, '').trim();
  }

  // 3. Fallback: If text still ends with a JSON block starting with { and ending with }
  const trailingBraceMatch = cleanReplyText.match(/\n\s*(\{[\s\S]*\})\s*$/);
  if (trailingBraceMatch) {
    try {
      if (!leadData) {
        leadData = JSON.parse(trailingBraceMatch[1].trim());
      }
      cleanReplyText = cleanReplyText.substring(0, trailingBraceMatch.index).trim();
    } catch (e) {}
  }

  // 4. Ultimate safety guard: Never let raw JSON keys reach WhatsApp under any circumstances
  const emergencyJsonRegex = /\n*\{[\s\r\n]*"(?:name|goal|medical_conditions|current_weight|is_qualified|lead_stage|lead_temperature)"[\s\S]*$/i;
  if (emergencyJsonRegex.test(cleanReplyText)) {
    const match = cleanReplyText.match(emergencyJsonRegex);
    if (!leadData && match) {
      try {
        const start = match[0].indexOf('{');
        const end = match[0].lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          leadData = JSON.parse(match[0].substring(start, end + 1));
        }
      } catch (e) {}
    }
    cleanReplyText = cleanReplyText.replace(emergencyJsonRegex, '').trim();
  }

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
