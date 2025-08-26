import React, { useState, useRef, useEffect } from 'react';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isListeningForWakeWord, setIsListeningForWakeWord] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentStatus, setCurrentStatus] = useState('AI Asistanınız hazır! Wake word: "Hey Asistan"');
  const [sessionMemoryEnabled, setSessionMemoryEnabled] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const wakeWordIntervalRef = useRef(null);
  const audioRef = useRef(null);
  const conversationEndRef = useRef(null);

  // Conversation history'ye yeni mesaj ekle
  const addConversation = (type, content, timestamp = new Date()) => {
    const newConversation = {
      id: Date.now() + Math.random(), // Unique key için random ekledik
      type, // 'user', 'assistant', 'system'
      content,
      timestamp
    };
    setConversations(prev => [...prev, newConversation]);
  };

  // Auto scroll to bottom
  useEffect(() => {
    if (conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversations]);

  // Wake word detection başlat
  const startWakeWordDetection = () => {
    if (isListeningForWakeWord) return;
    
    setIsListeningForWakeWord(true);
    setCurrentStatus('🎧 Wake word dinleniyor...');
    
    wakeWordIntervalRef.current = setInterval(async () => {
      await checkForWakeWord();
    }, 3000);
  };

  // Wake word detection durdur
  const stopWakeWordDetection = () => {
    setIsListeningForWakeWord(false);
    if (wakeWordIntervalRef.current) {
      clearInterval(wakeWordIntervalRef.current);
      wakeWordIntervalRef.current = null;
    }
    setCurrentStatus('Wake word detection durduruldu');
  };

  // Wake word kontrol et
  const checkForWakeWord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      const audioChunks = [];
      
      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const detected = await sendWakeWordToServer(audioBlob);
        
        if (detected) {
          stopWakeWordDetection();
          setCurrentStatus('🎯 Wake word algılandı! Komutunuzu söyleyin...');
          addConversation('system', '🎯 Wake word algılandı!');
          setTimeout(() => {
            startMainRecording();
          }, 1000);
        }
        
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 2000);
      
    } catch (error) {
      console.error('Wake word kayıt hatası:', error);
    }
  };

  // Wake word server'a gönder
  const sendWakeWordToServer = async (audioBlob) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'wakeword.webm');
      
      const response = await fetch('http://localhost:3001/api/wake-word/detect', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      return result.detected;
      
    } catch (error) {
      console.error('Wake word server hatası:', error);
      return false;
    }
  };

  // Ana ses kaydını başlat
  const startMainRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        sendAudioToServer(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      setCurrentStatus('🎤 Dinliyorum...');
      
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          stopMainRecording();
        }
      }, 10000);
      
    } catch (error) {
      console.error('Mikrofon erişim hatası:', error);
      setCurrentStatus('❌ Mikrofon izni gerekli!');
      setTimeout(() => {
        startWakeWordDetection();
      }, 2000);
    }
  };

  // Ana ses kaydını durdur
  const stopMainRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessing(true);
      setCurrentStatus('⏳ Ses işleniyor...');
    }
  };

  // Ses dosyasını server'a gönder
  const sendAudioToServer = async (audioBlob) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      // Session memory enabled ise conversation history gönder
      if (sessionMemoryEnabled) {
        const conversationHistory = conversations
          .filter(conv => conv.type !== 'system') // System mesajları hariç
          .slice(-10) // Son 10 konuşma
          .map(conv => ({
            role: conv.type === 'user' ? 'user' : 'assistant',
            content: conv.content
          }));
        
        formData.append('memoryEnabled', 'true');
        formData.append('conversationHistory', JSON.stringify(conversationHistory));
      }
      
      const response = await fetch('http://localhost:3001/api/voice/process', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      // User mesajını hemen ekle
      addConversation('user', result.transcription);
      
      // Assistant yanıtını hemen ekle
      addConversation('assistant', result.response);
      
      setCurrentStatus('✅ Yanıt alındı');
      
      // TTS çal (arka planda)
      if (ttsEnabled && result.response) {
        playTTS(result.response);
      }
      
      // 2 saniye sonra wake word detection'a geri dön
      setTimeout(() => {
        startWakeWordDetection();
      }, 2000);
      
    } catch (error) {
      console.error('Server hatası:', error);
      setCurrentStatus('❌ Server bağlantı hatası!');
      addConversation('system', '❌ Bağlantı hatası');
      
      setTimeout(() => {
        startWakeWordDetection();
      }, 2000);
    } finally {
      setIsProcessing(false);
    }
  };

  // Text-to-Speech çal
  const playTTS = async (text) => {
    try {
      setIsPlaying(true);
      
      const response = await fetch('http://localhost:3001/api/tts/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });
      
      const result = await response.json();
      
      if (result.success && result.audioBase64) {
        const audioBlob = new Blob(
          [Uint8Array.from(atob(result.audioBase64), c => c.charCodeAt(0))], 
          { type: 'audio/mpeg' }
        );
        
        const audioUrl = URL.createObjectURL(audioBlob);
        
        if (audioRef.current) {
          audioRef.current.pause();
        }
        
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        
        audio.onended = () => {
          setIsPlaying(false);
          URL.revokeObjectURL(audioUrl);
        };
        
        audio.onerror = () => {
          console.error('TTS çalma hatası');
          setIsPlaying(false);
          URL.revokeObjectURL(audioUrl);
        };
        
        await audio.play();
      }
      
    } catch (error) {
      console.error('TTS hatası:', error);
      setIsPlaying(false);
    }
  };

  // Manuel kayıt butonu
  const handleRecordClick = () => {
    if (isRecording) {
      stopMainRecording();
    } else {
      stopWakeWordDetection();
      startMainRecording();
    }
  };

  // Conversation history temizle
  const clearConversations = () => {
    setConversations([]);
    addConversation('system', 'Conversation history temizlendi');
  };

  // Component mount
  useEffect(() => {
    startWakeWordDetection();
    addConversation('system', 'AI Asistan başlatıldı');
    
    return () => {
      stopWakeWordDetection();
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  // Format timestamp
  const formatTime = (date) => {
    return date.toLocaleTimeString('tr-TR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div style={{ 
      display: 'flex',
      height: '100vh',
      fontFamily: "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      backgroundColor: '#f8fafc'
    }}>
      
      {/* Left Panel - Conversation History */}
      <div style={{
        flex: '1',
        backgroundColor: 'white',
        borderRight: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column'
      }}>
        
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc'
        }}>
          <h2 style={{ 
            margin: 0, 
            color: '#1e293b',
            fontSize: '20px',
            fontWeight: '600'
          }}>
            💬 Conversation History
          </h2>
          <button
            onClick={clearConversations}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              fontSize: '12px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              backgroundColor: 'white',
              color: '#64748b',
              cursor: 'pointer'
            }}
          >
            🗑️ Temizle
          </button>
        </div>
        
        {/* Conversation List */}
        <div style={{
          flex: '1',
          overflowY: 'auto',
          padding: '20px'
        }}>
          {conversations.map((conv) => (
            <div key={conv.id} style={{
              marginBottom: '16px',
              padding: '12px',
              borderRadius: '12px',
              backgroundColor: 
                conv.type === 'user' ? '#dbeafe' :
                conv.type === 'assistant' ? '#f0f9ff' : '#f1f5f9',
              border: '1px solid ' + (
                conv.type === 'user' ? '#93c5fd' :
                conv.type === 'assistant' ? '#0ea5e9' : '#cbd5e1'
              )
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: 
                    conv.type === 'user' ? '#1e40af' :
                    conv.type === 'assistant' ? '#0369a1' : '#475569'
                }}>
                  {conv.type === 'user' ? '👤 Sen' :
                   conv.type === 'assistant' ? '🤖 Asistan' : '⚙️ Sistem'}
                </span>
                <span style={{
                  fontSize: '11px',
                  color: '#64748b'
                }}>
                  {formatTime(conv.timestamp)}
                </span>
              </div>
              <div style={{
                fontSize: '14px',
                color: '#334155',
                lineHeight: '1.5'
              }}>
                {conv.content}
              </div>
            </div>
          ))}
          <div ref={conversationEndRef} />
        </div>
      </div>

      {/* Right Panel - Controls */}
      <div style={{
        width: '400px',
        backgroundColor: 'white',
        display: 'flex',
        flexDirection: 'column',
        padding: '30px'
      }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h1 style={{ 
            margin: '0 0 10px 0',
            color: '#0f172a',
            fontSize: '28px',
            fontWeight: '700'
          }}>
            🎙️ AI Asistan
          </h1>
          <p style={{
            margin: 0,
            color: '#64748b',
            fontSize: '14px'
          }}>
            Kişisel Sesli Asistanınız
          </p>
        </div>

        {/* Status Cards */}
        <div style={{ marginBottom: '30px' }}>
          {/* Wake Word Status */}
          <div style={{
            padding: '16px',
            margin: '10px 0',
            backgroundColor: isListeningForWakeWord ? '#dcfce7' : '#f1f5f9',
            borderRadius: '12px',
            border: '2px solid ' + (isListeningForWakeWord ? '#22c55e' : '#e2e8f0'),
            transition: 'all 0.3s'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ 
                fontSize: '14px', 
                fontWeight: '600',
                color: isListeningForWakeWord ? '#16a34a' : '#64748b'
              }}>
                🎧 Wake Word
              </span>
              <span style={{
                fontSize: '12px',
                padding: '4px 8px',
                borderRadius: '6px',
                backgroundColor: isListeningForWakeWord ? '#22c55e' : '#94a3b8',
                color: 'white',
                fontWeight: '500'
              }}>
                {isListeningForWakeWord ? 'Aktif' : 'Pasif'}
              </span>
            </div>
          </div>

          {/* Session Memory Status */}
          <div style={{
            padding: '16px',
            margin: '10px 0',
            backgroundColor: sessionMemoryEnabled ? '#fef3c7' : '#f1f5f9',
            borderRadius: '12px',
            border: '2px solid ' + (sessionMemoryEnabled ? '#f59e0b' : '#e2e8f0'),
            transition: 'all 0.3s'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ 
                fontSize: '14px', 
                fontWeight: '600',
                color: sessionMemoryEnabled ? '#d97706' : '#64748b'
              }}>
                🧠 Session Memory
              </span>
              <label style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={sessionMemoryEnabled}
                  onChange={(e) => setSessionMemoryEnabled(e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span style={{
                  fontSize: '12px',
                  color: sessionMemoryEnabled ? '#d97706' : '#64748b',
                  fontWeight: '500'
                }}>
                  {sessionMemoryEnabled ? 'Aktif' : 'Pasif'}
                </span>
              </label>
            </div>
            {sessionMemoryEnabled && (
              <div style={{
                marginTop: '8px',
                fontSize: '11px',
                color: '#92400e',
                backgroundColor: '#fef3c7',
                padding: '4px 8px',
                borderRadius: '4px'
              }}>
                💰 Daha fazla token harcar
              </div>
            )}
          </div>

          {/* TTS Status */}
          <div style={{
            padding: '16px',
            margin: '10px 0',
            backgroundColor: ttsEnabled ? '#dbeafe' : '#f1f5f9',
            borderRadius: '12px',
            border: '2px solid ' + (ttsEnabled ? '#3b82f6' : '#e2e8f0'),
            transition: 'all 0.3s'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ 
                fontSize: '14px', 
                fontWeight: '600',
                color: ttsEnabled ? '#2563eb' : '#64748b'
              }}>
                🔊 Sesli Yanıt
              </span>
              <label style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={ttsEnabled}
                  onChange={(e) => setTtsEnabled(e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span style={{
                  fontSize: '12px',
                  color: ttsEnabled ? '#2563eb' : '#64748b',
                  fontWeight: '500'
                }}>
                  {ttsEnabled ? 'Açık' : 'Kapalı'}
                  {isPlaying && ' (Çalıyor)'}
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Current Status */}
        <div style={{
          padding: '20px',
          backgroundColor: '#f8fafc',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          marginBottom: '30px',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '16px',
            color: '#334155',
            fontWeight: '500',
            lineHeight: '1.5'
          }}>
            {currentStatus}
          </div>
        </div>
        
        {/* Control Buttons */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '16px',
          marginBottom: '30px'
        }}>
          <button
            onClick={handleRecordClick}
            disabled={isProcessing}
            style={{
              padding: '18px 24px',
              fontSize: '16px',
              fontWeight: '600',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: 
                isRecording ? '#ef4444' : 
                isProcessing ? '#94a3b8' : '#22c55e',
              color: 'white',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}
          >
            {isProcessing ? '⏳ İşleniyor...' : 
             isRecording ? '🔴 Kaydı Durdur' : 
             '🎤 Manuel Kayıt'}
          </button>

          <button
            onClick={isListeningForWakeWord ? stopWakeWordDetection : startWakeWordDetection}
            disabled={isProcessing || isRecording}
            style={{
              padding: '18px 24px',
              fontSize: '16px',
              fontWeight: '600',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: 
                isListeningForWakeWord ? '#f59e0b' : '#3b82f6',
              color: 'white',
              cursor: (isProcessing || isRecording) ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}
          >
            {isListeningForWakeWord ? '⏸️ Wake Word Durdur' : '▶️ Wake Word Başlat'}
          </button>
        </div>
        
        {/* Connection Status */}
        <div style={{ 
          textAlign: 'center',
          fontSize: '12px',
          color: '#64748b',
          padding: '16px',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}>
          <div>🌐 Server: Bağlı</div>
          <div>🎧 Wake Word: {isListeningForWakeWord ? 'Dinliyor' : 'Pasif'}</div>
          <div>🔊 TTS: {ttsEnabled ? 'Açık' : 'Kapalı'}</div>
          <div>🧠 Memory: {sessionMemoryEnabled ? 'Aktif' : 'Pasif'}</div>
          {isPlaying && <div>🎵 Ses Çalıyor</div>}
        </div>
      </div>
    </div>
  );
}

export default App;