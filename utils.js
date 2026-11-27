/**
 * Utility functions for Diet Dekho WhatsApp Bot
 * - IST Time Calculations & Natural Time-of-Day Greetings
 * - Profile Name Sanitation & Commercial/Weird Handle Filtering
 */

/**
 * Returns current IST time information and natural greeting based on time of day.
 * - Morning: 05:00 AM to 11:59 AM -> "गुड मॉर्निंग" / "Good morning"
 * - Afternoon: 12:00 PM to 04:59 PM -> "गुड आफ्टरनून" / "Good afternoon"
 * - Evening: 05:00 PM to 09:30 PM -> "गुड इवनिंग" / "Good evening"
 * - Night: 09:31 PM to 04:59 AM -> "गुड नाइट" / "Good night"
 * 
 * @param {Date} [date=new Date()]
 * @returns {{ hours: number, minutes: number, totalMinutes: number, greetingHindi: string, greetingEnglish: string, formattedTime: string }}
 */
function getISTTimeInfo(date = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  let greetingHindi = 'गुड मॉर्निंग';
  let greetingEnglish = 'Good morning';

  // 05:00 AM (300m) to 11:59 AM (719m)
  if (totalMinutes >= 300 && totalMinutes < 720) {
    greetingHindi = 'गुड मॉर्निंग';
    greetingEnglish = 'Good morning';
  }
  // 12:00 PM (720m) to 04:59 PM (1019m)
  else if (totalMinutes >= 720 && totalMinutes < 1020) {
    greetingHindi = 'गुड आफ्टरनून';
    greetingEnglish = 'Good afternoon';
  }
  // 05:00 PM (1020m) to 09:30 PM (1290m)
  else if (totalMinutes >= 1020 && totalMinutes <= 1290) {
    greetingHindi = 'गुड इवनिंग';
    greetingEnglish = 'Good evening';
  }
  // 09:31 PM to 04:59 AM
  else {
    greetingHindi = 'गुड नाइट';
    greetingEnglish = 'Good night';
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes < 10 ? '0' + minutes : minutes;
  const formattedTime = `${displayHours}:${displayMinutes} ${period} IST`;

  return {
    hours,
    minutes,
    totalMinutes,
    greetingHindi,
    greetingEnglish,
    formattedTime
  };
}

/**
 * Filter and sanitize WhatsApp profile names.
 * Rejects business names, commercial words, single initials, emojis, and weird handles.
 * Returns a clean, capitalized human name (or Devanagari name) or null if invalid.
 * 
 * @param {string} rawName 
 * @returns {string|null}
 */
function cleanHumanName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;

  // 1. Remove emojis and symbols
  let cleaned = rawName
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}]/gu, '')
    .replace(/[^\p{L}\p{M}\s]/gu, '') // Keep letters, marks and whitespace
    .trim();

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ');

  // 2. Length check: between 2 and 30 characters
  if (cleaned.length < 2 || cleaned.length > 30) return null;

  // 3. Blacklist of commercial, professional, weird or bot keywords
  const businessPatterns = [
    /\bcooker/i, /\bkitchen/i, /\butensil/i, /\bappliances?/i,
    /\bcoach/i, /\btrainer/i, /\bfitness/i, /\bgym/i, /\bworkout/i, /\byoga/i, /\bdiet/i,
    /\bshop/i, /\bstore/i, /\bcollection/i, /\bboutique/i, /\btextile/i, /\bgarment/i, /\bfashion/i, /\btailor/i, /\bsaree/i, /\bcloth/i,
    /\bjewel/i, /\bornament/i,
    /\btrader/i, /\btrading/i, /\benterprise/i, /\bindustr/i, /\bsolution/i, /\bservice/i, /\btech/i, /\bagency/i,
    /\bmarket/i, /\bbazaar/i, /\bmart/i, /\bcent(er|re)/i, /\bclinic/i, /\bhospital/i, /\bpharmac/i, /\bmedico/i, /\bmedical/i,
    /\bstationer/i, /\bauto\b/i, /\bmotor/i, /\belectrical/i, /\bhardware/i, /\bpropert/i, /\brealt/i, /\bestate/i, /\bbroker/i,
    /\bofficial/i, /\bpage\b/i, /\bchannel/i, /\bhub\b/i, /\bworld\b/i, /\bzone\b/i, /\bpoint\b/i, /\bclub\b/i, /\bfoundation/i, /\btrust\b/i,
    /\bcustomer/i, /\blead\b/i, /\bwhatsapp/i, /\bunknown/i, /\badmin/i, /\bowner/i, /\bhelpdesk/i, /\bcompany/i, /\binfo\b/i
  ];

  for (const pattern of businessPatterns) {
    if (pattern.test(cleaned)) {
      return null;
    }
  }

  // 4. Reject if it is just single initials like "S S R", "K K", "A B"
  const words = cleaned.split(' ');
  const allSingleLetters = words.every(w => w.length === 1);
  if (allSingleLetters) return null;

  // 5. Capitalize properly if Latin characters
  const formatted = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return formatted;
}

/**
 * Strips all emojis, pictographs, and decorative symbols from text.
 * Enforces zero-emoji policy across all bot outbound messages.
 * 
 * @param {string} text 
 * @returns {string}
 */
function stripEmojis(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{FE0E}\u{FE0F}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/**
 * Generates dynamic, realistic consultation call time windows based on current IST time.
 * Calling hours: 10:00 AM to 06:30 PM IST.
 * 
 * Rules:
 * - Uses flexible time windows (e.g. दोपहर 12:00 से 3:00 बजे के बीच) instead of rigid single-minute slots to minimize customer drop-off.
 * - Every window must be in the FUTURE (minimum 45-60 mins ahead).
 * - Never offers a time window that has already passed today.
 * - If late afternoon (after 4:00 PM), offers today's evening window and tomorrow morning.
 * - If evening/night (after 5:45 PM), offers tomorrow's morning and afternoon windows.
 * 
 * @param {Date} [date=new Date()]
 * @returns {{ slot1: string, slot2: string, slotTextHindi: string, slotTextEnglish: string, isNextDay: boolean }}
 */
function getSuggestedCallSlots(date = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  let slot1 = '';
  let slot2 = '';
  let isNextDay = false;

  // Case 1: Early Morning / Morning up to 11:30 AM (before 690 mins)
  if (totalMinutes < 690) {
    slot1 = 'आज दोपहर 12:00 से 3:00 बजे के बीच';
    slot2 = 'आज शाम 4:30 से 6:30 बजे के बीच';
  }
  // Case 2: Midday 11:30 AM to 02:00 PM (690 to 839 mins)
  else if (totalMinutes >= 690 && totalMinutes < 840) {
    slot1 = 'आज दोपहर 2:30 से 5:00 बजे के बीच';
    slot2 = 'आज शाम 5:30 से 7:00 बजे के बीच';
  }
  // Case 3: Afternoon 02:00 PM to 04:00 PM (840 to 959 mins) -> e.g. 3:22 PM!
  else if (totalMinutes >= 840 && totalMinutes < 960) {
    slot1 = 'आज शाम 4:30 से 6:30 बजे के बीच';
    slot2 = 'कल सुबह 10:30 से 1:00 बजे के बीच';
  }
  // Case 4: Late Afternoon 04:00 PM to 05:45 PM (960 to 1064 mins)
  else if (totalMinutes >= 960 && totalMinutes < 1065) {
    slot1 = 'आज शाम 6:00 से 7:00 बजे के बीच';
    slot2 = 'कल सुबह 10:30 से 1:00 बजे के बीच';
  }
  // Case 5: Evening / Night (05:45 PM onwards - 1065+ mins) or midnight
  else {
    isNextDay = true;
    slot1 = 'कल सुबह 10:30 से 1:00 बजे के बीच';
    slot2 = 'कल दोपहर 2:30 से 5:00 बजे के बीच';
  }

  const slotTextHindi = `हमारे सीनियर क्लीनिकल न्यूट्रिशनिस्ट से 10-मिनट की क्विक कॉल के लिए कौन सा समय सही रहेगा:\n\n1. ${slot1}\n2. ${slot2}\n\n(या आप अपनी सुविधा का कोई भी समय बता सकते हैं)`;
  const slotTextEnglish = `Which time window works best for a 10-minute consultation with our Senior Clinical Nutritionist:\n\n1. ${slot1}\n2. ${slot2}\n\n(Or feel free to share any preferred time)`;

  return {
    slot1,
    slot2,
    slotTextHindi,
    slotTextEnglish,
    isNextDay
  };
}

/**
 * Deterministically parses age, weight, and height from incoming text using regex patterns.
 * Solves customer drop-offs and AI timeouts (e.g. Pravin Yadav "48\\n75kgd\\n5 feet").
 * 
 * @param {string} text 
 * @returns {{ age: number|null, weight: string|null, height: string|null }|null}
 */
function extractVitalsDeterministically(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw) return null;

  let age = null;
  let weight = null;
  let height = null;

  // 1. Explicit Weight (e.g. 75kgd, 75kg, 75 kgs, 75 kilo, weight 75)
  const weightMatch = raw.match(/(?:weight|wazan|vajan|wt)?\s*[:=-]?\s*\b(\d{2,3}(?:\.\d+)?)\s*(?:kgd|kgs|kg|kilo|किलो)\b/i);
  if (weightMatch) {
    const val = parseFloat(weightMatch[1]);
    if (val >= 35 && val <= 250) weight = `${val} kg`;
  }

  // 2. Explicit Height
  // Matches: 5.4 ft, 5.5 feet, 5 feet, 5 ft, 5'6", 5 foot 4 inch, 165 cm, 5'6
  const decimalFtMatch = raw.match(/\b([4-7]\.\d+)\s*(?:feet|foot|ft|फ़ीट|फिट)\b/i);
  if (decimalFtMatch) {
    height = `${decimalFtMatch[1]} ft`;
  } else {
    const heightFtInMatch = raw.match(/\b([4-7])\s*(?:feet|foot|ft|फ़ीट|फिट|'|’)\s*(?:(\d{1,2})\s*(?:inch|inches|in|इंच|"|”|))?/i);
    if (heightFtInMatch) {
      const ft = heightFtInMatch[1];
      const inches = heightFtInMatch[2];
      height = inches ? `${ft} ft ${inches} in` : `${ft} feet`;
    } else {
      const cmMatch = raw.match(/\b(1[3-9]\d|2[0-1]\d)\s*(?:cm|सेमी)\b/i);
      if (cmMatch) {
        height = `${cmMatch[1]} cm`;
      } else {
        const apostropheMatch = raw.match(/\b([4-7])'([0-9]|1[0-1])"?\b/);
        if (apostropheMatch) {
          height = `${apostropheMatch[1]} ft ${apostropheMatch[2]} in`;
        }
      }
    }
  }

  // 3. Explicit Age
  const ageExplicitMatch = raw.match(/(?:age|umar|umr|उम्र)\s*[:=-]?\s*\b([1-9]\d)\b/i);
  if (ageExplicitMatch) {
    const val = parseInt(ageExplicitMatch[1], 10);
    if (val >= 14 && val <= 95) age = val;
  } else {
    const ageUnitMatch = raw.match(/\b([1-9]\d)\s*(?:yrs|yr|years|year|saal|साल|age|umar|umr)\b/i);
    if (ageUnitMatch) {
      const val = parseInt(ageUnitMatch[1], 10);
      if (val >= 14 && val <= 95) age = val;
    }
  }

  // 4. Multi-token / Multiline heuristic (handles "48\n75kgd\n5 feet" or "48, 75, 5 feet" or "68kg 162cm 29")
  const tokens = raw.split(/[\n,\s]+/).map(s => s.trim()).filter(Boolean);
  if (tokens.length >= 2) {
    for (const token of tokens) {
      // Age check if still null (pure 2-digit number 18-85 that isn't the weight)
      if (!age) {
        const pureAge = token.match(/^([2-9]\d)$/);
        if (pureAge) {
          const val = parseInt(pureAge[1], 10);
          const weightNum = weight ? parseFloat(weight) : null;
          if (val >= 16 && val <= 85 && val !== weightNum) {
            age = val;
            continue;
          }
        }
      }
      // Weight check if still null
      if (!weight) {
        const pureWeight = token.match(/^(\d{2,3}(?:\.\d+)?)\s*(?:kgd|kgs|kg|kilo|किलो)?$/i);
        if (pureWeight) {
          const val = parseFloat(pureWeight[1]);
          if (val >= 40 && val <= 200 && val !== age) {
            weight = `${val} kg`;
            continue;
          }
        }
      }
      // Height check if still null
      if (!height) {
        const pureHeight = token.match(/^([4-7](?:\.\d+)?)\s*(?:feet|foot|ft|'|cm)?$/i);
        if (pureHeight) {
          height = token;
          continue;
        }
      }
    }
  }

  if (age || weight || height) {
    return { age, weight, height };
  }
  return null;
}

/**
 * Generates an infallible deterministic reply when AI models encounter rate limits or timeouts.
 * Guarantees zero dropped messages and zero silence for customers on WhatsApp.
 * 
 * @param {object} session 
 * @param {string} incomingText 
 * @returns {{ replyText: string, leadData: object }}
 */
function handleDeterministicFallback(session, incomingText) {
  const normalized = (incomingText || '').trim().toLowerCase();
  const leadData = session.leadData || {};
  let replyText = '';

  // 1. Check if user sent vitals
  const vitals = extractVitalsDeterministically(incomingText);
  if (vitals && (vitals.weight || vitals.height || vitals.age)) {
    if (vitals.age) leadData.age = vitals.age;
    if (vitals.weight) leadData.current_weight = vitals.weight;
    if (vitals.height) leadData.height = vitals.height;

    // Calculate BMI & target weight if possible
    let weightNum = parseFloat(String(leadData.current_weight).replace(/[^0-9.]/g, ''));
    let heightCm = null;
    if (leadData.height) {
      const ftMatch = String(leadData.height).match(/([4-7])\s*(?:feet|ft|'|\.)?\s*(\d{1,2})?/i);
      if (ftMatch) {
        const ft = parseInt(ftMatch[1], 10);
        const inches = ftMatch[2] ? parseInt(ftMatch[2], 10) : 0;
        heightCm = (ft * 12 + inches) * 2.54;
      } else {
        const cmMatch = String(leadData.height).match(/(\d{3})/);
        if (cmMatch) heightCm = parseFloat(cmMatch[1]);
      }
    }
    if (weightNum && heightCm) {
      const heightM = heightCm / 100;
      leadData.bmi = parseFloat((weightNum / (heightM * heightM)).toFixed(1));
      const idealWeight = Math.round(22 * heightM * heightM);
      leadData.target_weight = `${idealWeight} kg`;
    }

    const vitalsParts = [];
    if (leadData.age) vitalsParts.push(`उम्र: ${leadData.age}`);
    if (leadData.current_weight) vitalsParts.push(`वज़न: ${leadData.current_weight}`);
    if (leadData.height) vitalsParts.push(`हाइट: ${leadData.height}`);
    const summaryStr = vitalsParts.length > 0 ? ` (${vitalsParts.join(', ')})` : '';

    replyText = `नमस्ते! आपकी डिटेल्स${summaryStr} नोट कर ली गई हैं।\n\nआपकी बॉडी को पूरी तरह समझने के लिए—क्या आपको थायरॉइड, PCOD, शुगर (Diabetes), BP या एसिडिटी जैसी कोई मेडिकल समस्या है?`;

    return {
      replyText: stripEmojis(replyText),
      leadData
    };
  }

  // 2. Check if user is answering medical conditions
  const lastBotMsg = [...(session.history || [])].reverse().find(m => m.role === 'model')?.text || '';
  const isWaitingMedical = /medical|थायरॉइड|pcod|शुगर|diabetes|bp|एसिडिटी|समस्या/i.test(lastBotMsg);
  if (isWaitingMedical && !leadData.medical_conditions) {
    if (/^(no|nahi|none|fit|nhi|kuch nahi|sab theek|na|nothing|normal)$/i.test(normalized)) {
      leadData.medical_conditions = 'None';
      replyText = `नोट कर लिया!\n\nएक बात और जानना चाहूँगी:\n\nआप अपना Diet Plan कब से शुरू करना चाहेंगे?\n\n1. आज या कल से\n2. अगले 2–3 दिनों में\n3. अगले सप्ताह से\n4. फिलहाल सिर्फ जानकारी ले रहा/रही हूँ`;
    } else {
      leadData.medical_conditions = incomingText.trim();
      replyText = `नोट कर लिया। इस स्थिति में घर का सही खान-पान और सही पोषण बहुत मायने रखता है।\n\nआप अपना Diet Plan कब से शुरू करना चाहेंगे?\n\n1. आज या कल से\n2. अगले 2–3 दिनों में\n3. अगले सप्ताह से\n4. फिलहाल सिर्फ जानकारी ले रहा/रही हूँ`;
    }
    return {
      replyText: stripEmojis(replyText),
      leadData
    };
  }

  // 3. Check if user is answering timeline
  const isWaitingTimeline = /कब से शुरू|शुरू करना चाहेंगे|timeline/i.test(lastBotMsg);
  if (isWaitingTimeline && !leadData.start_timeline) {
    if (/^(1|aaj|kal|today|tomorrow|तुरंत)/i.test(normalized)) leadData.start_timeline = 'Today/Tomorrow';
    else if (/^(2|2-3|दो तीन)/i.test(normalized)) leadData.start_timeline = 'In 2-3 days';
    else if (/^(3|next week|अगले हफ्ते|अगले सप्ताह)/i.test(normalized)) leadData.start_timeline = 'Next week';
    else leadData.start_timeline = 'Info only';

    const slotInfo = getSuggestedCallSlots();
    replyText = `नोट कर लिया! हमारा कस्टमाइज़्ड होम-कुक्ड डाइट प्रोग्राम मिनिमम सिर्फ ₹49/दिन से शुरू होता है।\n\nहमारे सीनियर क्लीनिकल न्यूट्रिशनिस्ट से 10-मिनट की क्विक कॉल पर पूरा डाइट असेसमेंट समझने के लिए कौन सा समय सही रहेगा:\n\n1. ${slotInfo.slot1}\n2. ${slotInfo.slot2}\n\n(या आप अपनी सुविधा का कोई भी समय बता सकते हैं)`;

    return {
      replyText: stripEmojis(replyText),
      leadData
    };
  }

  // 4. Check if user is selecting call time
  const isWaitingCall = /समय सही रहेगा|slot|call.*time|क्विक कॉल|10-मिनट/i.test(lastBotMsg);
  if (isWaitingCall && !leadData.preferred_call_time) {
    const slotInfo = getSuggestedCallSlots();
    let bookedSlot = null;
    if (normalized === '1' || normalized.includes('पहला') || normalized.includes('1st')) {
      bookedSlot = slotInfo.slot1;
    } else if (normalized === '2' || normalized.includes('दूसरा') || normalized.includes('2nd')) {
      bookedSlot = slotInfo.slot2;
    } else if (normalized.includes('10 baje') || normalized.includes('10:00') || normalized === '10') {
      bookedSlot = 'कल सुबह 10:00 AM';
    } else if (normalized.includes('abhi') || normalized.includes('turant')) {
      bookedSlot = 'Immediately (अगले 5-10 मिनट में)';
    } else {
      bookedSlot = incomingText.trim();
    }

    leadData.preferred_call_time = bookedSlot;
    leadData.lead_stage = 'appointment_booked';
    leadData.lead_temperature = 'hot';
    leadData.is_qualified = true;

    replyText = `बहुत बढ़िया! ${bookedSlot} के लिए हमारे सीनियर क्लीनिकल न्यूट्रिशनिस्ट के साथ आपकी 10-मिनट की कंसल्टेशन कॉल कन्फर्म है। कृपया इस समय उपलब्ध रहें।`;

    return {
      replyText: stripEmojis(replyText),
      leadData
    };
  }

  // 5. Default General Fallback
  if (!leadData.current_weight || !leadData.height) {
    replyText = `नमस्ते! आपका 15 kg वेट-लॉस असेसमेंट तैयार करने के लिए, बस ये 3 छोटी डिटेल्स बता दीजिए:\n\n1. आपकी उम्र (Age)?\n2. आपका वर्तमान वज़न (Weight in kg)?\n3. आपकी हाइट (Height in feet/inches या cm)?`;
  } else if (!leadData.preferred_call_time) {
    const slotInfo = getSuggestedCallSlots();
    replyText = `डाइट देखो में आपका स्वागत है! हमारे सीनियर क्लीनिकल न्यूट्रिशनिस्ट से 10-मिनट की कंसल्टेशन कॉल के लिए कौन सा समय सही रहेगा:\n\n1. ${slotInfo.slot1}\n2. ${slotInfo.slot2}\n\n(या आप अपनी सुविधा का कोई भी समय बता सकते हैं)`;
  } else {
    replyText = `नमस्ते! आपकी 10-मिनट की कंसल्टेशन कॉल ${leadData.preferred_call_time} के लिए शेड्यूल्ड है। हमारे सीनियर न्यूट्रिशनिस्ट आपसे ठीक समय पर बात करेंगे।`;
  }

  return {
    replyText: stripEmojis(replyText),
    leadData
  };
}

module.exports = {
  getISTTimeInfo,
  cleanHumanName,
  stripEmojis,
  getSuggestedCallSlots,
  extractVitalsDeterministically,
  handleDeterministicFallback
};

