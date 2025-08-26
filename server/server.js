const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const upload = multer({ dest: 'uploads/' });

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'AI Assistant Server çalışıyor!' });
});

// Text-to-Speech endpoint
app.post('/api/tts/generate', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text required' });
    }

    console.log('TTS için metin:', text);
    
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: text,
    });

    const audioBuffer = Buffer.from(await mp3.arrayBuffer());
    
    // Base64 olarak gönder (CORS sorununu bypass eder)
    const base64Audio = audioBuffer.toString('base64');
    
    console.log('TTS dosyası oluşturuldu (Base64)');
    
    res.json({
      success: true,
      audioBase64: base64Audio,
      mimeType: 'audio/mpeg'
    });
    
  } catch (error) {
    console.error('TTS Error:', error.message);
    res.status(500).json({ error: 'TTS generation failed: ' + error.message });
  }
});

// Audio dosyalarını serve et
app.get('/api/audio/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join('uploads', filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }
    
    // CORS headers ekle
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-cache');
    
    const audioStream = fs.createReadStream(filepath);
    audioStream.pipe(res);
    
    // Dosyayı 30 saniye sonra sil
    setTimeout(() => {
      try {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
          console.log('TTS dosyası silindi:', filename);
        }
      } catch (err) {
        console.error('Dosya silme hatası:', err.message);
      }
    }, 30000);
    
  } catch (error) {
    console.error('Audio serve error:', error.message);
    res.status(500).json({ error: 'Audio serve failed' });
  }
});

// Wake word detection endpoint
app.post('/api/wake-word/detect', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ detected: false });
    }
    
    console.log('Wake word detection için ses alındı:', req.file.filename);
    
    // Dosyayı .webm uzantısıyla yeniden adlandır
    const newPath = req.file.path + '.webm';
    fs.renameSync(req.file.path, newPath);
    
    // Whisper ile transcription yap
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(newPath),
      model: "whisper-1",
    });
    
    console.log('Wake word transcription:', transcription.text);
    
    // Wake word detection - "hey asistan", "merhaba asistan", "asistan" gibi kelimeler ara
    const wakeWords = ['hey asistan', 'merhaba asistan', 'asistan', 'hey assistant'];
    const text = transcription.text.toLowerCase();
    const detected = wakeWords.some(word => text.includes(word));
    
    console.log('Wake word detected:', detected);
    
    // Dosyayı temizle
    fs.unlinkSync(newPath);
    
    res.json({ 
      detected,
      transcription: transcription.text
    });
    
  } catch (error) {
    console.error('Wake word detection error:', error.message);
    
    // Hata durumunda dosyayı temizle
    try {
      if (req.file) {
        const newPath = req.file.path + '.webm';
        if (fs.existsSync(newPath)) {
          fs.unlinkSync(newPath);
        } else if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError.message);
    }
    
    res.json({ detected: false });
  }
});

// Voice processing endpoint with session memory support
app.post('/api/voice/process', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('Ses dosyası alındı:', req.file.filename);
    
    // Session memory enabled mi kontrol et
    const memoryEnabled = req.body.memoryEnabled === 'true';
    let conversationHistory = [];
    
    if (memoryEnabled && req.body.conversationHistory) {
      try {
        conversationHistory = JSON.parse(req.body.conversationHistory);
        console.log('📚 Session memory aktif - Conversation history:', conversationHistory.length, 'mesaj');
      } catch (error) {
        console.error('Conversation history parse hatası:', error);
      }
    }
    
    // Dosyayı .webm uzantısıyla yeniden adlandır
    const newPath = req.file.path + '.webm';
    fs.renameSync(req.file.path, newPath);
    
    console.log('Yeni dosya yolu:', newPath);
    
    // Gerçek Whisper API çağrısı
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(newPath),
      model: "whisper-1",
    });
    
    console.log('Transkripsiyon:', transcription.text);
    
    // GPT-4 mesajlarını hazırla
    let messages = [
      {
        role: "system", 
        content: "Sen Türkçe konuşan kişisel bir asistansın. Kısa ve samimi yanıtlar ver. 2-3 cümleden fazla uzun yazma."
      }
    ];
    
    // Session memory enabled ise conversation history ekle
    if (memoryEnabled && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
      console.log('💰 Memory enabled - Toplam mesaj sayısı:', messages.length + 1);
    }
    
    // Son user mesajını ekle
    messages.push({
      role: "user", 
      content: transcription.text
    });
    
    // GPT-4 ile yanıt oluştur
    const completion = await openai.chat.completions.create({
      messages: messages,
      model: "gpt-4",
    });
    
    const aiResponse = completion.choices[0].message.content;
    console.log('AI Yanıtı:', aiResponse);
    
    // Token usage log
    if (completion.usage) {
      console.log('Token kullanımı:', {
        prompt: completion.usage.prompt_tokens,
        completion: completion.usage.completion_tokens,
        total: completion.usage.total_tokens,
        memory_enabled: memoryEnabled
      });
    }
    
    // Ses dosyasını temizle
    fs.unlinkSync(newPath);
    
    res.json({ 
      transcription: transcription.text,
      response: aiResponse,
      memoryEnabled: memoryEnabled,
      tokenUsage: completion.usage || null
    });
    
  } catch (error) {
    console.error('Detaylı Error:', error.message);
    
    // Hata durumunda dosyayı temizle
    try {
      if (req.file) {
        const newPath = req.file.path + '.webm';
        if (fs.existsSync(newPath)) {
          fs.unlinkSync(newPath);
        } else if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError.message);
    }
    
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda çalışıyor`);
  console.log(`📝 Voice processing: /api/voice/process`);
  console.log(`🎤 Wake word detection: /api/wake-word/detect`);
  console.log(`🔊 Text-to-Speech: /api/tts/generate`);
  console.log(`🧠 Session memory: Opsiyonel`);
});