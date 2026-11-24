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

module.exports = {
  getISTTimeInfo,
  cleanHumanName
};
