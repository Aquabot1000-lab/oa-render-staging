/**
 * ElevenLabs Conversational AI Phone Handler for OverAssessed
 * 
 * Uses Twilio ConversationRelay with ElevenLabs TTS + Deepgram STT
 * and Anthropic Claude for AI conversation logic.
 * 
 * DRAFT — Do not import yet. Review and integrate into server.js.
 * 
 * Architecture:
 *   Caller → Twilio → <Connect><ConversationRelay> → WebSocket → this handler
 *   This handler → Claude API → text tokens → Twilio → ElevenLabs TTS → Caller
 */

const { WebSocketServer } = require('ws');

// ============================================================
// CONFIGURATION
// ============================================================

const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'UgBBYS2sOqTuMpoF3BR0';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const TYLER_CELL = '+12105598725';
const OA_NUMBER = '+18882829165';
const NOTIFY_PHONE = process.env.NOTIFY_PHONE || TYLER_CELL;

// ============================================================
// SYSTEM PROMPT — Property Tax Protest Expert "Sarah"
// ============================================================

const SYSTEM_PROMPT = `You are Sarah, the friendly and knowledgeable phone receptionist at OverAssessed. You sound natural, warm, confident, and helpful — like a real person who genuinely cares, not a robot reading a script.

ABOUT OVERASSESSED:
- Property tax protest experts serving all of Texas AND Georgia
- How it works: Give us your property address → we run a free analysis → if you're overpaying, we file the protest and handle everything → you save money
- Pricing: 20% of tax savings in Texas, 25% in Georgia. No upfront cost. You only pay if we actually save you money.
- Timeline: TX protest season is mid-April through August. TX deadline is May 15. GA deadline is 45 days after assessment notice (April-June).
- Georgia special: If you win an appeal, your value is FROZEN for 3 years. That's 3 years of guaranteed savings from one appeal.
- Homestead exemptions: We file those too, included free with our service
- Website: overassessed.ai (Georgia: overassessed.ai/georgia)
- Owner: Tyler Worthey personally reviews every case
- Phone: (888) 282-9165

LEAD CAPTURE (YOUR #1 JOB):
Your primary goal is to collect the caller's information so we can run their free analysis. You need:
1. Their NAME (first and last)
2. Their PROPERTY ADDRESS (full street address, city, state)
3. Their PHONE NUMBER or EMAIL for follow-up
Ask for these ONE AT A TIME. Start with "Can I get your name?" then address, then contact info.
Once you have all three, say: "Perfect! I've got everything I need. We'll run your free analysis and Tyler will personally follow up with your results within 24 hours."

PHONE CALL RULES (CRITICAL):
- Keep responses to 1-2 SHORT sentences. This is a phone call, not an essay.
- Sound natural. Use contractions — "we'll", "you're", "that's", "don't".
- When someone gives info, REPEAT IT BACK briefly: "Got it, John Smith at 123 Main Street."
- If speech sounds garbled: "Sorry, I didn't quite catch that. Could you say that again?"
- If they ask something you don't know: "Great question — Tyler can get into the details on that when he follows up. Want me to grab your info so he can reach out?"
- ALWAYS steer toward collecting their info
- Your name is Sarah. You're the front office assistant.
- NEVER use markdown, bullet points, asterisks, numbered lists, or any formatting
- Be conversational and warm. Be human.
- If they seem hesitant: "No worries at all. The analysis is completely free, no strings attached. We just need your address to check."

TRANSFER RULES:
- If caller says "transfer", "speak to someone", "talk to Tyler", "operator", "human", or "representative":
  → Respond: "Of course! Let me connect you with Tyler right now. One moment."
  → Then add [TRANSFER] at the end of your response (the system will handle the transfer)
- If caller presses 0 on their keypad, treat it as a transfer request

ENDING THE CALL:
- If caller says "goodbye", "bye", "that's all", "nothing else", "hang up":
  → Respond: "Thank you for calling OverAssessed! Have a great day. Goodbye!"
  → Then add [END] at the end of your response

INTERRUPTION HANDLING:
- The caller can interrupt you mid-sentence. This is normal.
- Don't repeat what you were saying. Just respond to what they said.
- Don't acknowledge being interrupted ("Oh sorry" etc). Just flow naturally.`;

// ============================================================
// CONVERSATION STATE
// ============================================================

// Map<callSid, ConversationState>
const conversations = new Map();

// Clean up stale conversations every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [sid, state] of conversations) {
        if (now - state.startTime > 30 * 60 * 1000) {
            conversations.delete(sid);
        }
    }
}, 5 * 60 * 1000);

// ============================================================
// HELPER: Check business hours (M-F 8AM-6PM CT)
// ============================================================

function isBusinessHours() {
    const now = new Date();
    const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const day = ct.getDay();
    const hour = ct.getHours();
    return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

// ============================================================
// HELPER: Call Claude with streaming
// ============================================================

async function* streamClaude(messages) {
    if (!ANTHROPIC_API_KEY) {
        yield 'I apologize, I\'m having some technical difficulty. Let me transfer you to Tyler.';
        yield '[TRANSFER]';
        return;
    }

    const anthropicMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
    }));

    try {
        const resp = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 200,
                stream: true,
                system: SYSTEM_PROMPT,
                messages: anthropicMessages
            })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error('[ConvRelay] Claude error:', resp.status, errText);
            yield 'I\'m having a brief technical issue. Let me connect you with Tyler.';
            yield '[TRANSFER]';
            return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;

                try {
                    const event = JSON.parse(data);
                    if (event.type === 'content_block_delta' && event.delta?.text) {
                        fullResponse += event.delta.text;
                        yield event.delta.text;
                    }
                } catch (e) {
                    // Skip malformed JSON
                }
            }
        }

        if (!fullResponse) {
            yield 'Sorry, could you say that again?';
        }
    } catch (err) {
        console.error('[ConvRelay] Claude fetch error:', err.message);
        yield 'I\'m having a brief technical issue. Let me connect you with Tyler.';
        yield '[TRANSFER]';
    }
}

// Non-streaming fallback (simpler, for debugging)
async function callClaude(messages) {
    if (!ANTHROPIC_API_KEY) return null;

    const anthropicMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
    }));

    try {
        const resp = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 200,
                system: SYSTEM_PROMPT,
                messages: anthropicMessages
            })
        });

        if (!resp.ok) return null;
        const data = await resp.json();
        return data.content?.[0]?.text || null;
    } catch (err) {
        console.error('[ConvRelay] Claude error:', err.message);
        return null;
    }
}

// ============================================================
// HELPER: Extract lead info from conversation
// ============================================================

function extractCallerInfo(messages) {
    const info = { name: null, address: null, phone: null, email: null };
    const fullText = messages.map(m => m.content).join(' ');

    const emailMatch = fullText.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
    if (emailMatch) info.email = emailMatch[0];

    return info;
}

// ============================================================
// HELPER: Send call summary to Tyler
// ============================================================

async function sendCallSummary(callSid, state, twilioClient, sgMail) {
    if (!state || !state.messages.length) return;

    const callerNumber = state.callerNumber || 'Unknown';
    const callerInfo = extractCallerInfo(state.messages);
    const callTime = new Date(state.startTime).toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const duration = Math.round((Date.now() - state.startTime) / 1000);

    // Build transcript
    const transcript = state.messages.map(m => {
        const speaker = m.role === 'assistant' ? 'AI (Sarah)' : 'Caller';
        return `${speaker}: ${m.content}`;
    }).join('\n');

    // SMS to Tyler
    const smsLines = [
        `📞 AI Call Summary`,
        `From: ${callerNumber}`,
        `Time: ${callTime}`,
        `Duration: ${duration}s`
    ];
    if (callerInfo.name) smsLines.push(`Name: ${callerInfo.name}`);
    if (callerInfo.address) smsLines.push(`Property: ${callerInfo.address}`);
    if (callerInfo.email) smsLines.push(`Email: ${callerInfo.email}`);

    const firstUserMsg = state.messages.find(m => m.role === 'user');
    if (firstUserMsg) smsLines.push(`Topic: ${firstUserMsg.content.substring(0, 80)}`);

    if (twilioClient) {
        try {
            await twilioClient.messages.create({
                body: smsLines.join('\n'),
                from: OA_NUMBER,
                to: NOTIFY_PHONE
            });
            console.log(`📱 [ConvRelay] SMS summary sent for ${callSid}`);
        } catch (err) {
            console.error('[ConvRelay] SMS error:', err.message);
        }
    }

    // Email to Tyler — full transcript
    if (sgMail && process.env.SENDGRID_API_KEY) {
        try {
            const transcriptHtml = state.messages.map(m => {
                const speaker = m.role === 'assistant' ? '🤖 Sarah (AI)' : '👤 Caller';
                const color = m.role === 'assistant' ? '#2563eb' : '#16a34a';
                return `<p><strong style="color:${color}">${speaker}:</strong> ${m.content}</p>`;
            }).join('');

            await sgMail.send({
                to: 'tyler@overassessed.ai',
                from: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai',
                subject: `📞 AI Call from ${callerNumber} — ${callTime}`,
                html: `
                    <h2>AI Phone Call Summary</h2>
                    <table style="border-collapse:collapse;margin-bottom:16px;">
                        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Caller:</td><td>${callerNumber}</td></tr>
                        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Time:</td><td>${callTime}</td></tr>
                        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Duration:</td><td>${duration} seconds</td></tr>
                        ${callerInfo.name ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Name:</td><td>${callerInfo.name}</td></tr>` : ''}
                        ${callerInfo.address ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Property:</td><td>${callerInfo.address}</td></tr>` : ''}
                        ${callerInfo.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td><td>${callerInfo.email}</td></tr>` : ''}
                    </table>
                    <h3>Full Conversation</h3>
                    ${transcriptHtml}
                    <hr>
                    <p style="color:#888;font-size:12px;">OverAssessed AI Phone — (888) 282-9165 — Powered by ConversationRelay + ElevenLabs</p>
                `
            });
            console.log(`📧 [ConvRelay] Email summary sent for ${callSid}`);
        } catch (err) {
            console.error('[ConvRelay] Email error:', err.message);
        }
    }
}

// ============================================================
// MAIN: Setup Express routes + WebSocket handler
// ============================================================

/**
 * Call this function from server.js to register the new phone handler.
 * 
 * Usage in server.js:
 *   const { setupConversationRelay } = require('./elevenlabs-phone-handler');
 *   // After app.listen():
 *   const server = app.listen(PORT, () => { ... });
 *   setupConversationRelay(app, server, twilioClient, sgMail);
 * 
 * @param {Express} app - Express application
 * @param {http.Server} httpServer - HTTP server (for WebSocket upgrade)
 * @param {TwilioClient} twilioClient - Twilio REST client
 * @param {SendGrid} sgMail - SendGrid mail client
 */
function setupConversationRelay(app, httpServer, twilioClient, sgMail) {

    // --------------------------------------------------------
    // 1. TwiML endpoint — answers inbound calls
    // --------------------------------------------------------
    // NOTE: This REPLACES the existing /twiml/voice handler.
    // Use the USE_CONVERSATION_RELAY feature flag to switch.

    app.post('/twiml/voice-v2', (req, res) => {
        const callSid = req.body?.CallSid || 'unknown';
        const callerNumber = req.body?.From || 'Unknown';

        console.log(`📞 [ConvRelay] Incoming call from ${callerNumber} (${callSid})`);

        const VoiceResponse = require('twilio').twiml.VoiceResponse;
        const response = new VoiceResponse();

        const connect = response.connect({
            action: '/twiml/conversation-complete'
        });

        const cr = connect.conversationRelay({
            url: `wss://${req.headers.host}/ws/conversation`,
            ttsProvider: 'ElevenLabs',
            voice: ELEVENLABS_VOICE_ID,
            welcomeGreeting: 'Thank you for calling OverAssessed! We help Texas homeowners lower their property tax assessments. My name is Sarah — are you looking to protest your property taxes?',
            welcomeGreetingInterruptible: 'speech',
            transcriptionProvider: 'Deepgram',
            speechModel: 'nova-3-general',
            language: 'en-US',
            interruptible: 'speech',
            interruptSensitivity: 'medium',
            dtmfDetection: true
        });

        // Pass caller info as custom parameters
        cr.parameter({ name: 'callerNumber', value: callerNumber });
        cr.parameter({ name: 'callSid', value: callSid });

        res.type('text/xml').send(response.toString());
    });

    // --------------------------------------------------------
    // 2. Conversation complete — called when ConversationRelay ends
    // --------------------------------------------------------

    app.post('/twiml/conversation-complete', (req, res) => {
        const callSid = req.body?.CallSid || 'unknown';
        let handoffData = {};

        try {
            handoffData = JSON.parse(req.body?.HandoffData || '{}');
        } catch (e) {
            // No handoff data
        }

        console.log(`📞 [ConvRelay] Session ended for ${callSid}`, handoffData);

        const state = conversations.get(callSid);

        if (handoffData.action === 'transfer') {
            // Transfer to Tyler
            if (isBusinessHours()) {
                const VoiceResponse = require('twilio').twiml.VoiceResponse;
                const response = new VoiceResponse();
                response.say({ voice: 'Polly.Joanna' }, 'Connecting you now. One moment.');
                const dial = response.dial({
                    timeout: 20,
                    callerId: OA_NUMBER,
                    action: '/twiml/ai-transfer-status'
                });
                dial.number(TYLER_CELL);
                res.type('text/xml').send(response.toString());
            } else {
                const VoiceResponse = require('twilio').twiml.VoiceResponse;
                const response = new VoiceResponse();
                response.say(
                    { voice: 'Polly.Joanna' },
                    'We\'re currently outside business hours. Tyler will call you back within one business hour when we reopen. Thank you for calling OverAssessed!'
                );
                response.hangup();
                res.type('text/xml').send(response.toString());
            }

            // Send summary
            if (state) {
                sendCallSummary(callSid, state, twilioClient, sgMail).catch(err =>
                    console.error('[ConvRelay] Summary error:', err.message)
                );
            }
        } else {
            // Normal end
            const VoiceResponse = require('twilio').twiml.VoiceResponse;
            const response = new VoiceResponse();
            response.hangup();
            res.type('text/xml').send(response.toString());

            // Send summary
            if (state) {
                sendCallSummary(callSid, state, twilioClient, sgMail).catch(err =>
                    console.error('[ConvRelay] Summary error:', err.message)
                );
            }
        }
    });

    // --------------------------------------------------------
    // 3. WebSocket server — real-time conversation handler
    // --------------------------------------------------------

    const wss = new WebSocketServer({ server: httpServer, path: '/ws/conversation' });

    wss.on('connection', (ws) => {
        let callSid = null;
        let callerNumber = null;
        let state = null;

        console.log('🔌 [ConvRelay] WebSocket connected');

        ws.on('message', async (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString());
            } catch (e) {
                console.error('[ConvRelay] Invalid JSON:', data.toString().substring(0, 100));
                return;
            }

            switch (msg.type) {

                // ---- SETUP: Connection established ----
                case 'setup': {
                    callSid = msg.callSid || msg.customParameters?.callSid || 'unknown';
                    callerNumber = msg.from || msg.customParameters?.callerNumber || 'Unknown';

                    console.log(`📞 [ConvRelay] Setup: ${callerNumber} → ${callSid}`);

                    state = {
                        messages: [{
                            role: 'assistant',
                            content: 'Thank you for calling OverAssessed! We help Texas homeowners lower their property tax assessments. My name is Sarah — are you looking to protest your property taxes?'
                        }],
                        callerInfo: { phone: callerNumber },
                        startTime: Date.now(),
                        callerNumber,
                        callSid
                    };
                    conversations.set(callSid, state);
                    break;
                }

                // ---- PROMPT: Caller said something ----
                case 'prompt': {
                    const speech = msg.voicePrompt || '';
                    if (!speech.trim()) break;

                    console.log(`🗣️ [ConvRelay] Caller (${callSid}): "${speech}"`);

                    if (!state) {
                        state = {
                            messages: [],
                            callerInfo: {},
                            startTime: Date.now(),
                            callerNumber: callerNumber || 'Unknown',
                            callSid
                        };
                        conversations.set(callSid, state);
                    }

                    state.messages.push({ role: 'user', content: speech });

                    // Stream Claude response → send text tokens to Twilio
                    let fullResponse = '';
                    let isTransfer = false;
                    let isEnd = false;
                    let tokenBuffer = '';

                    for await (const chunk of streamClaude(state.messages)) {
                        fullResponse += chunk;
                        tokenBuffer += chunk;

                        // Check for control tags
                        if (fullResponse.includes('[TRANSFER]')) {
                            isTransfer = true;
                            // Remove the tag from what we send
                            tokenBuffer = tokenBuffer.replace('[TRANSFER]', '');
                        }
                        if (fullResponse.includes('[END]')) {
                            isEnd = true;
                            tokenBuffer = tokenBuffer.replace('[END]', '');
                        }

                        // Send tokens as they accumulate (batch by sentence fragments for natural TTS)
                        // Send on sentence boundaries or when buffer gets long
                        if (tokenBuffer.length > 0 && (
                            tokenBuffer.includes('.') ||
                            tokenBuffer.includes('!') ||
                            tokenBuffer.includes('?') ||
                            tokenBuffer.includes(',') ||
                            tokenBuffer.length > 60
                        )) {
                            const tokenToSend = tokenBuffer.trim();
                            if (tokenToSend) {
                                ws.send(JSON.stringify({
                                    type: 'text',
                                    token: tokenToSend,
                                    last: false
                                }));
                            }
                            tokenBuffer = '';
                        }
                    }

                    // Send any remaining buffer as the last token
                    const remaining = tokenBuffer.replace('[TRANSFER]', '').replace('[END]', '').trim();
                    ws.send(JSON.stringify({
                        type: 'text',
                        token: remaining || ' ',
                        last: true
                    }));

                    // Clean response for storage
                    const cleanResponse = fullResponse
                        .replace('[TRANSFER]', '')
                        .replace('[END]', '')
                        .trim();
                    
                    state.messages.push({ role: 'assistant', content: cleanResponse });

                    console.log(`🤖 [ConvRelay] Sarah (${callSid}): "${cleanResponse.substring(0, 100)}..."`);

                    // Handle transfer
                    if (isTransfer) {
                        // Wait a moment for TTS to play, then end session with transfer handoff
                        setTimeout(() => {
                            ws.send(JSON.stringify({
                                type: 'end',
                                handoffData: JSON.stringify({
                                    action: 'transfer',
                                    reason: 'caller_request'
                                })
                            }));
                        }, 3000);
                    }

                    // Handle end
                    if (isEnd) {
                        setTimeout(() => {
                            ws.send(JSON.stringify({
                                type: 'end',
                                handoffData: JSON.stringify({
                                    action: 'end',
                                    reason: 'caller_goodbye'
                                })
                            }));
                        }, 2000);
                    }

                    break;
                }

                // ---- DTMF: Caller pressed a key ----
                case 'dtmf': {
                    const digit = msg.digit;
                    console.log(`🔢 [ConvRelay] DTMF (${callSid}): ${digit}`);

                    if (digit === '0') {
                        // Transfer to operator
                        ws.send(JSON.stringify({
                            type: 'text',
                            token: 'Of course! Let me connect you with Tyler right now.',
                            last: true
                        }));

                        setTimeout(() => {
                            ws.send(JSON.stringify({
                                type: 'end',
                                handoffData: JSON.stringify({
                                    action: 'transfer',
                                    reason: 'dtmf_0_pressed'
                                })
                            }));
                        }, 2500);
                    }
                    break;
                }

                // ---- INTERRUPT: Caller interrupted AI speech ----
                case 'interrupt': {
                    console.log(`⏸️ [ConvRelay] Interrupted (${callSid}) after: "${msg.utteranceUntilInterrupt?.substring(0, 50)}..."`);
                    // No action needed — ConversationRelay handles stopping TTS
                    // The next prompt message will contain what the caller said
                    break;
                }

                // ---- ERROR: Something went wrong ----
                case 'error': {
                    console.error(`❌ [ConvRelay] Error (${callSid}):`, msg.description);
                    break;
                }

                default: {
                    console.log(`[ConvRelay] Unknown message type: ${msg.type}`);
                }
            }
        });

        ws.on('close', (code, reason) => {
            console.log(`🔌 [ConvRelay] WebSocket closed (${callSid}): ${code} ${reason}`);
            // Summary will be sent from the conversation-complete handler
        });

        ws.on('error', (err) => {
            console.error(`❌ [ConvRelay] WebSocket error (${callSid}):`, err.message);
        });
    });

    console.log('🎙️ [ConvRelay] ElevenLabs ConversationRelay handler ready');
    return wss;
}

// ============================================================
// INTEGRATION INSTRUCTIONS
// ============================================================
/*
To integrate into server.js:

1. Install ws:
   npm install ws

2. At the top of server.js, add:
   const { setupConversationRelay } = require('./elevenlabs-phone-handler');

3. Change app.listen() to capture the server:
   // OLD:
   app.listen(PORT, () => { ... });
   
   // NEW:
   const server = app.listen(PORT, () => { ... });

4. After the listen call, add:
   setupConversationRelay(app, server, twilioClient, sgMail);

5. Add feature flag to the existing /twiml/voice handler:
   
   const USE_CONVERSATION_RELAY = process.env.USE_CONVERSATION_RELAY === 'true';
   
   app.post('/twiml/voice', (req, res) => {
       if (USE_CONVERSATION_RELAY) {
           // Forward to v2 handler
           return res.redirect(307, '/twiml/voice-v2');
       }
       // ... existing Gather + Say code ...
   });

6. Add to .env:
   USE_CONVERSATION_RELAY=true
   ELEVENLABS_VOICE_ID=UgBBYS2sOqTuMpoF3BR0

7. Deploy and test!

ROLLBACK: Set USE_CONVERSATION_RELAY=false in env vars to instantly revert.
*/

module.exports = { setupConversationRelay, conversations };
