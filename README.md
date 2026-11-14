# Diet Dekho WhatsApp AI Lead Qualification Bot 🚀

Diet Dekho ke liye 24/7 AI-powered WhatsApp Lead Qualification Bot.
Powered by **Google Gemini AI**, **Finbite WhatsApp Business API**, aur **NeoDove CRM**.

---

## 🌟 Features

1. **24/7 Auto-Reply:** Google Gemini 2.5 Flash dwara customer ke har message ka insano jaisa, warm & empathetic uttar.
2. **Master Lead Qualification (v2 Rules):**
   - Goal, Medical screening, Height/Weight, BMI (Asian-Indian cutoffs 18.5–22.9), Name, City, Call time slot (10:00 AM – 6:30 PM).
   - Strict ₹49/day price anchor. No free full diet chart on chat.
   - Medical red-flags safety check (pregnancy, minor, ed_concern).
3. **Smart Time-Aware Follow-up (DND Night Protection):**
   - Din me drop-off hone par 2.5 ghante me gentle check-in.
   - Raat 9:30 PM se subah 9:00 AM tak DND (pause), agle din 9:30 AM par fresh morning follow-up.
4. **NeoDove CRM Auto-Push:** Lead qualify hote hi real-time CRM me push.
5. **Deduplication & Multi-turn Session Memory:** WhatsApp conversation context yaad rakhta hai.

---

## 📁 Project Structure

```
diet-dekho-whatsapp-bot/
├── .env                  # API keys and configuration
├── .env.example          # Template for environment variables
├── gemini.js             # Gemini AI integration & <lead_data> JSON parser
├── whatsapp.js           # Finbite WhatsApp API outbound messaging
├── followup.js           # Smart 24-hr follow-up engine with DND
├── neodove.js            # NeoDove CRM custom integration webhook
├── system_prompt.js      # Diet Dekho v2 Master Prompt
├── server.js             # Express webhook server
├── test_bot.js           # Local offline simulation test script
├── render.yaml           # One-click Render deployment configuration
└── package.json
```

---

## 🚀 Quick Setup & Local Testing

### Step 1: Install Dependencies
```bash
cd /Users/abhi/.gemini/antigravity/scratch/diet-dekho-whatsapp-bot
npm install
```

### Step 2: Add your Gemini API Key in `.env`
Open `.env` and paste your free Google Gemini API key:
```env
GEMINI_API_KEY=AIzaSy...
```
*(Get your free key in 10 seconds from https://aistudio.google.com/)*

### Step 3: Run the Local Simulation Test
Test the full 3-turn lead qualification conversation right in your terminal:
```bash
node test_bot.js
```

### Step 4: Start the Local Webhook Server
```bash
npm start
```
Server will start on `http://localhost:3000`.

---

## 🌐 24/7 Free Cloud Deployment on Render.com

Apne bot ko 24 ghante bina laptop ke online rakhne ke liye:

1. **GitHub par code upload karein:**
   - GitHub par ek private repository banayein aur ye folder push kar dein.
2. **Render.com par jayein:**
   - [Render.com](https://render.com/) par free account banayein ya login karein.
   - **New +** par click karein → **Web Service** chunein.
   - Apni GitHub repository select karein.
   - **Environment Variables** me ye daalein:
     - `GEMINI_API_KEY`: Aapki Google Gemini Key
     - `FINBITE_API_KEY`: `8c80a778aa11a4d527b7631e517e6106af077aad9d3a435a10e5c8dc42eb4eaf`
     - `FINBITE_PHONE_ID`: `699877843205192`
     - `NEODOVE_WEBHOOK_URL`: (Jab ready ho tab paste karein, abhi khali chhod sakte hain)
3. **Deploy** par click karein.
   - Render aapko ek live URL de dega, jaise:
     `https://diet-dekho-bot.onrender.com`

---

## 🔗 Finbite Dashboard me Webhook kaise jodein

1. Apne Finbite Dashboard me jayein:
   👉 `https://automate.finbite.in/vb/manage/webhook`
2. **Add Webhook Endpoint** par click karein.
3. Webhook URL dalein:
   `https://diet-dekho-bot.onrender.com/webhook`
4. Events select karein:
   - `message-received`
   - `text-message-received`
5. **Save** karein!

Bas! Ab koi bhi aapke WhatsApp number (+919536907133) par message bhejega, Gemini AI turant 2-3 second me smart reply karega aur lead qualify karke NeoDove ke liye ready kar dega!
