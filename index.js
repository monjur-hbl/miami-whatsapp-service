// Miami Beach Resort - WhatsApp Service v2
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;

// State
let qrCodeData = null;
let connectionStatus = 'initializing';
let clientInfo = null;
let lastError = null;
let client = null;
let initAttempts = 0;

// Clean session directory
function cleanSession() {
    const sessionPath = '/tmp/wa-session';
    try {
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        fs.mkdirSync(sessionPath, { recursive: true });
    } catch (e) {
        console.log('Session cleanup:', e.message);
    }
}

// Find Chrome
function getChromePath() {
    const paths = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable'];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// Create WhatsApp client
async function createClient() {
    initAttempts++;
    console.log('Creating client, attempt:', initAttempts);
    
    // Clean old session on first attempt
    if (initAttempts === 1) cleanSession();
    
    const chromePath = getChromePath();
    console.log('Chrome:', chromePath);
    
    if (client) {
        try {
            await client.destroy();
        } catch (e) {}
        client = null;
    }
    
    client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'miami-' + Date.now(),
            dataPath: '/tmp/wa-session'
        }),
        puppeteer: {
            headless: true,
            executablePath: chromePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log('QR received');
        connectionStatus = 'qr_ready';
        qrCodeData = await QRCode.toDataURL(qr, { width: 280 }).catch(() => null);
    });

    client.on('ready', () => {
        console.log('Ready!');
        connectionStatus = 'connected';
        qrCodeData = null;
        clientInfo = client.info;
        console.log('Connected:', clientInfo?.pushname);
    });

    client.on('authenticated', () => {
        console.log('Authenticated');
        connectionStatus = 'connecting';
    });

    client.on('auth_failure', (msg) => {
        console.log('Auth fail:', msg);
        connectionStatus = 'disconnected';
        lastError = msg;
    });

    client.on('disconnected', (reason) => {
        console.log('Disconnected:', reason);
        connectionStatus = 'disconnected';
        clientInfo = null;
    });

    client.on('loading_screen', (pct) => {
        console.log('Loading:', pct + '%');
        connectionStatus = 'connecting';
    });

    try {
        await client.initialize();
    } catch (err) {
        console.log('Init error:', err.message);
        lastError = err.message;
        connectionStatus = 'error';
    }
}

// Start
console.log('Starting WhatsApp service on port', PORT);
createClient();

// === API ===

app.get('/', (req, res) => res.json({ service: 'Miami WhatsApp', status: connectionStatus }));

app.get('/status', (req, res) => res.json({
    status: connectionStatus,
    qrCode: qrCodeData,
    connectedAs: clientInfo ? { name: clientInfo.pushname, phone: clientInfo.wid?.user } : null,
    lastError,
    initAttempts
}));

app.get('/qr', (req, res) => {
    const style = 'body{background:#111b21;color:#fff;font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}';
    if (qrCodeData) {
        res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="5"><style>${style}</style></head><body><h2>📱 Scan with WhatsApp</h2><img src="${qrCodeData}" style="border-radius:10px"/><p style="color:#8696a0;margin-top:20px">Refreshes in 5s</p></body></html>`);
    } else if (connectionStatus === 'connected') {
        res.send(`<!DOCTYPE html><html><head><style>${style}.ok{color:#25D366;font-size:60px}</style></head><body><div class="ok">✅</div><h2>Connected!</h2><p>${clientInfo?.pushname || ''}</p></body></html>`);
    } else {
        res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"><style>${style}</style></head><body><h2>⏳ ${connectionStatus === 'error' ? 'Error' : 'Loading...'}</h2><p>${lastError || 'Please wait...'}</p></body></html>`);
    }
});

app.post('/send', async (req, res) => {
    try {
        const { phone, message } = req.body;
        if (!phone || !message) return res.status(400).json({ success: false, error: 'Missing phone/message' });
        if (connectionStatus !== 'connected') return res.status(503).json({ success: false, error: 'Not connected' });
        
        let p = phone.replace(/[^0-9]/g, '');
        if (p.startsWith('0')) p = '88' + p;
        else if (!p.startsWith('88') && p.length === 11) p = '88' + p;
        
        const chatId = p + '@c.us';
        if (!await client.isRegisteredUser(chatId)) return res.status(400).json({ success: false, error: 'Not on WhatsApp' });
        
        const result = await client.sendMessage(chatId, message);
        res.json({ success: true, messageId: result.id._serialized, to: p });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/send-pdf', async (req, res) => {
    try {
        const { phone, message, pdfBase64, filename } = req.body;
        if (!phone) return res.status(400).json({ success: false, error: 'Missing phone' });
        if (connectionStatus !== 'connected') return res.status(503).json({ success: false, error: 'Not connected' });
        
        let p = phone.replace(/[^0-9]/g, '');
        if (p.startsWith('0')) p = '88' + p;
        else if (!p.startsWith('88') && p.length === 11) p = '88' + p;
        
        const chatId = p + '@c.us';
        if (!await client.isRegisteredUser(chatId)) return res.status(400).json({ success: false, error: 'Not on WhatsApp' });
        
        if (message) await client.sendMessage(chatId, message);
        if (pdfBase64) {
            const media = new MessageMedia('application/pdf', pdfBase64, filename || 'Invoice.pdf');
            await client.sendMessage(chatId, media);
        }
        res.json({ success: true, to: p });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/logout', async (req, res) => {
    try {
        if (client) await client.logout();
        connectionStatus = 'disconnected';
        clientInfo = null;
        qrCodeData = null;
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/restart', async (req, res) => {
    connectionStatus = 'initializing';
    qrCodeData = null;
    lastError = null;
    if (client) { try { await client.destroy(); } catch(e){} }
    setTimeout(createClient, 1000);
    res.json({ success: true });
});

app.listen(PORT);
