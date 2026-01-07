// Miami Beach Resort - WhatsApp Service
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;

// Store connection state
let qrCodeData = null;
let connectionStatus = 'initializing';
let clientInfo = null;
let lastError = null;
let client = null;
let initAttempts = 0;

// Find Chrome/Chromium path
function getChromePath() {
    const paths = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        process.env.PUPPETEER_EXECUTABLE_PATH
    ];
    const fs = require('fs');
    for (const p of paths) {
        if (p && fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

// Initialize WhatsApp client
function createClient() {
    initAttempts++;
    console.log('Init attempt:', initAttempts);
    console.log('Creating WhatsApp client...');
    
    const chromePath = getChromePath();
    console.log('Chrome path:', chromePath);
    
    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: '/tmp/whatsapp-session'
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
                '--disable-gpu',
                '--disable-extensions',
                '--disable-software-rasterizer',
                '--disable-features=site-per-process',
                '--disable-web-security'
            ]
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/AhmedAlaa12/niceworker/main/niceworker.json'
        }
    });

    // QR Code event
    client.on('qr', async (qr) => {
        console.log('QR Code received');
        connectionStatus = 'qr_ready';
        try {
            qrCodeData = await QRCode.toDataURL(qr, { width: 300 });
        } catch (err) {
            console.error('QR generation error:', err);
        }
    });

    // Ready event
    client.on('ready', () => {
        console.log('WhatsApp client is ready!');
        connectionStatus = 'connected';
        qrCodeData = null;
        clientInfo = client.info;
        console.log('Connected as:', clientInfo?.pushname, clientInfo?.wid?.user);
    });

    // Authenticated
    client.on('authenticated', () => {
        console.log('WhatsApp authenticated');
        connectionStatus = 'connecting';
    });

    // Auth failure
    client.on('auth_failure', (msg) => {
        console.error('Auth failure:', msg);
        connectionStatus = 'disconnected';
        lastError = 'Auth failed: ' + msg;
    });

    // Disconnected
    client.on('disconnected', (reason) => {
        console.log('Disconnected:', reason);
        connectionStatus = 'disconnected';
        clientInfo = null;
        lastError = reason;
        // Reconnect after delay
        setTimeout(createClient, 5000);
    });

    // Loading screen
    client.on('loading_screen', (percent, message) => {
        console.log('Loading:', percent + '%', message);
        connectionStatus = 'connecting';
    });

    // Initialize
    client.initialize().catch(err => {
        console.error('Init error:', err.message);
        lastError = err.message;
        connectionStatus = 'error';
    });
}

// Start
console.log('WhatsApp service on', PORT);
createClient();

// ============ API ENDPOINTS ============

app.get('/', (req, res) => {
    res.json({ service: 'Miami WhatsApp', status: connectionStatus });
});

app.get('/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qrCode: qrCodeData,
        connectedAs: clientInfo ? { name: clientInfo.pushname, phone: clientInfo.wid?.user } : null,
        lastError: lastError,
        initAttempts: initAttempts
    });
});

app.get('/qr', (req, res) => {
    if (qrCodeData) {
        res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="5"><style>body{background:#111b21;color:#fff;font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}img{border-radius:10px}</style></head><body><h2>📱 Scan with WhatsApp</h2><img src="${qrCodeData}"/><p style="color:#8696a0">Auto-refreshes every 5s</p></body></html>`);
    } else if (connectionStatus === 'connected') {
        res.send(`<!DOCTYPE html><html><head><style>body{background:#111b21;color:#fff;font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}.ok{color:#25D366;font-size:60px}</style></head><body><div class="ok">✅</div><h2>Connected!</h2><p>${clientInfo?.pushname || ''} (${clientInfo?.wid?.user || ''})</p></body></html>`);
    } else {
        res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"><style>body{background:#111b21;color:#fff;font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}</style></head><body><h2>⏳ Loading...</h2><p>Status: ${connectionStatus}</p><p>Attempt: ${initAttempts}</p></body></html>`);
    }
});

app.post('/send', async (req, res) => {
    try {
        const { phone, message } = req.body;
        if (!phone || !message) return res.status(400).json({ success: false, error: 'Phone and message required' });
        if (connectionStatus !== 'connected') return res.status(503).json({ success: false, error: 'Not connected' });
        
        let formattedPhone = phone.replace(/[^0-9]/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '88' + formattedPhone;
        else if (!formattedPhone.startsWith('88') && formattedPhone.length === 11) formattedPhone = '88' + formattedPhone;
        
        const chatId = formattedPhone + '@c.us';
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) return res.status(400).json({ success: false, error: 'Not on WhatsApp' });
        
        const result = await client.sendMessage(chatId, message);
        res.json({ success: true, messageId: result.id._serialized, to: formattedPhone });
    } catch (error) {
        console.error('Send error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/send-pdf', async (req, res) => {
    try {
        const { phone, message, pdfBase64, filename } = req.body;
        if (!phone) return res.status(400).json({ success: false, error: 'Phone required' });
        if (connectionStatus !== 'connected') return res.status(503).json({ success: false, error: 'Not connected' });
        
        let formattedPhone = phone.replace(/[^0-9]/g, '');
        if (formattedPhone.startsWith('0')) formattedPhone = '88' + formattedPhone;
        else if (!formattedPhone.startsWith('88') && formattedPhone.length === 11) formattedPhone = '88' + formattedPhone;
        
        const chatId = formattedPhone + '@c.us';
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) return res.status(400).json({ success: false, error: 'Not on WhatsApp' });
        
        if (message) await client.sendMessage(chatId, message);
        if (pdfBase64) {
            const media = new MessageMedia('application/pdf', pdfBase64, filename || 'Invoice.pdf');
            await client.sendMessage(chatId, media, { caption: filename || 'Invoice.pdf' });
        }
        
        res.json({ success: true, to: formattedPhone });
    } catch (error) {
        console.error('Send PDF error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/logout', async (req, res) => {
    try {
        if (client) await client.logout();
        connectionStatus = 'disconnected';
        clientInfo = null;
        qrCodeData = null;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/restart', async (req, res) => {
    try {
        connectionStatus = 'initializing';
        qrCodeData = null;
        if (client) await client.destroy().catch(() => {});
        setTimeout(createClient, 2000);
        res.json({ success: true, message: 'Restarting...' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => console.log('Listening on', PORT));
