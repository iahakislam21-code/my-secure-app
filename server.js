const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post('/api/verify-access', async (req, res) => {
  const { phone, deviceId } = req.body;
  if (!phone || !deviceId) return res.status(400).json({ allowed: false, message: 'Invalid payload' });

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('phone_number', phone)
    .maybeSingle();

  if (error || !user) return res.status(403).json({ allowed: false, message: 'User not found' });
  if (!user.is_active) return res.status(403).json({ allowed: false, message: 'Payment required' });
  if (user.device_token && user.device_token !== deviceId) {
    return res.status(403).json({ allowed: false, message: 'Device limit reached' });
  }

  if (!user.device_token) {
    await supabaseAdmin.from('users').update({ device_token: deviceId }).eq('phone_number', phone);
  }

  return res.json({ allowed: true, userPhone: user.phone_number });
});

app.post('/api/get-vocab-data', async (req, res) => {
  const { phone, deviceId, wordToGenerate, practiceId } = req.body;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('is_active, device_token')
    .eq('phone_number', phone)
    .single();

  if (!user || !user.is_active || user.device_token !== deviceId) {
    return res.status(401).json({ error: 'Unauthorized request' });
  }

  try {
    const promptText = `Provide JSON output for English word: "${wordToGenerate}"`;
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });

    const resData = await geminiRes.json();
    let resultText = resData.candidates[0].content.parts[0].text;
    const parsedJson = JSON.parse(resultText.replace(/```json|```/g, '').trim());

    await supabaseAdmin.from('practice_clips').update({ vocab_data: parsedJson }).eq('practice_id', practiceId);

    return res.json(parsedJson);
  } catch (err) {
    return res.status(500).json({ error: 'AI Generation Failed' });
  }
});

app.listen(5000, () => console.log('Server running on port 5000'));
