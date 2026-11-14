require('dotenv').config();
const { generateGeminiReply } = require('./gemini');

async function runTest() {
  console.log('====================================================');
  console.log('🧪 TESTING DIET DEKHO AI BOT (GEMINI ENGINE)');
  console.log('====================================================\n');

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.error('❌ Error: Please set a valid GEMINI_API_KEY in your .env file first!');
    console.log('Get a free key from: https://aistudio.google.com/\n');
    process.exit(1);
  }

  const simulatedChat = [
    "Hi, I want to lose weight.",
    "No medical conditions, pure vegetarian. Height is 5'4 and weight is 75 kg.",
    "My name is Priya, I live in Jaipur. Tomorrow at 3:00 PM works for me."
  ];

  const history = [];

  for (let i = 0; i < simulatedChat.length; i++) {
    const userMsg = simulatedChat[i];
    console.log(`\n💬 [USER Turn ${i+1}]: "${userMsg}"`);
    console.log('⏳ Thinking (Gemini)...');

    try {
      const { replyText, leadData } = await generateGeminiReply(history, userMsg);

      console.log(`\n🤖 [AI Aanya]:\n${replyText}\n`);
      console.log(`📊 [Extracted Lead Data]:`, JSON.stringify(leadData, null, 2));

      history.push({ role: 'user', text: userMsg });
      history.push({ role: 'model', text: replyText });

      if (leadData?.is_qualified) {
        console.log('\n🎉 SUCCESS: LEAD HAS BEEN QUALIFIED! Ready to push to NeoDove.');
      }
    } catch (err) {
      console.error('❌ Test failed with error:', err.message);
      break;
    }
  }
}

runTest();
