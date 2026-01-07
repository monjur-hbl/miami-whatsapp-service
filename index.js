const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;

let qrCodeData = null;
let connectionStatus = 'initializing';
let clientInfo = null;
let lastError = null;
let client = null;
let initAttempts = 0;

function createClient() {
    console.log('Creating WhatsApp client...');
    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
    console.log('Chrome path:', chromePath);
    
    return new Client({
        authStrategy: new LocalAuth({ dataPath: '/tmp/whatsapp-session' }),
        puppeteer: {
            headless: true,
            executablePath: chromePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process', '--disable-extensions'],
            timeout: 180000
        }
    });
}

async function initializeClient() {
    if (client) { try { await client.destroy(); } catch (e) { } }
    initAttempts++;
    console.log('Init attempt:', initAttempts);
    connectionStatus = 'initializing';
    qrCodeData = null;
    lastError = null;
    
    client = createClient();
    
    client.on('qr', async (qr) => {
        console.log('QR received');
        connectionStatus = 'qr_ready';
        initAttempts = 0;
        try { qrCodeData = await QRCode.toDataURL(qr, { width: 300 }); } catch (e) { lastError = e.message; }
    });
    client.on('ready', () => { console.log('Connected!'); connectionStatus = 'connected'; qrCodeData = null; clientInfo = client.info; initAttempts = 0; });
    client.on('authenticated', () => { console.log('Authenticated'); connectionStatus = 'connecting'; });
    client.on('auth_failure', (msg) => { connectionStatus = 'disconnected'; lastError = 'Auth failed: ' + msg; });
    client.on('disconnected', (reason) => { connectionStatus = 'disconnected'; clientInfo = null; lastError = reason; if (initAttempts < 3) setTimeout(initializeClient, 10000); });
    client.on('loading_screen', (p, m) => { console.log('Loading:', p + '%'); connectionStatus = 'connecting'; });
    
    try { await client.initialize(); } catch (e) { console.error('Init error:', e.message); connectionStatus = 'error'; lastError = e.message; if (initAttempts < 3) setTimeout(initializeClient, 15000); }
}

app.get('/', (req, res) => res.json({ service: 'Miami WhatsApp', status: connectionStatus }));
app.get('/status', (req, res) => res.json({ status: connectionStatus, qrCode: qrCodeData, connectedAs: clientInfo ? { name: clientInfo.pushname, phone: clientInfo.wid?.user } : null, lastError, initAttempts }));
app.get('/qr', (req, res) => {
    const html = (t, b) => `<!DOCTYPE html><html><head><title>${t}</title><meta http-equiv="refresh" content="5"><style>body{background:#111b21;color:#fff;font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}img{border-radius:10px}.err{color:#ef4444}</style></head><body>${b}</body></html>`;
    if (qrCodeData) res.send(html('QR', `<h2>📱 Scan QR</h2><img src="${qrCodeData}"/><p>Waiting...</p>`));
    else if (connectionStatus === 'connected') res.send(html('OK', `<div style="font-size:60px">✅</div><h2>Connected!</h2><p>${clientInfo?.pushname||''} +${clientInfo?.wid?.user||''}</p>`));
    else res.send(html('Loading', `<h2>${connectionStatus==='error'?'⚠️':'⏳'} ${connectionStatus}</h2>${lastError?'<p class="err">'+lastError+'</p>':''}`));
});
app.post('/send', async (req, res) => {
    try {
        const { phone, message } = req.body;
        if (!phone || !message) return res.status(400).json({ error: 'Phone and message required' });
        if (connectionStatus !== 'connected') return res.status(503).json({ error: 'Not connected' });
        let p = phone.replace(/[^0-9]/g, ''); if (p.startsWith('0')) p = '88' + p; else if (!p.startsWith('88') && p.length === 11) p = '88' + p;
        const chatId = p + '@c.us';
        if (!await client.isRegisteredUser(chatId)) return res.status(400).json({ error: 'Not on WhatsApp' });
        const r = await client.sendMessage(chatId, message);
        res.json({ success: true, messageId: r.id._serialized, to: p });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/send-pdf', async (req, res) => {
    try {
        const { phone, message, pdfBase64, filename } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone required' });
        if (connectionStatus !== 'connected') return res.status(503).json({ error: 'Not connected' });
        let p = phone.replace(/[^0-9]/g, ''); if (p.startsWith('0')) p = '88' + p; else if (!p.startsWith('88') && p.length === 11) p = '88' + p;
        const chatId = p + '@c.us';
        if (!await client.isRegisteredUser(chatId)) return res.status(400).json({ error: 'Not on WhatsApp' });
        if (message) await client.sendMessage(chatId, message);
        if (pdfBase64) { const m = new MessageMedia('application/pdf', pdfBase64, filename || 'Invoice.pdf'); await client.sendMessage(chatId, m); }
        res.json({ success: true, to: p });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/logout', async (req, res) => { try { if (client) await client.logout(); connectionStatus = 'disconnected'; clientInfo = null; qrCodeData = null; res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/restart', (req, res) => { initAttempts = 0; connectionStatus = 'initializing'; qrCodeData = null; lastError = null; res.json({ success: true }); setTimeout(initializeClient, 1000); });

app.listen(PORT, () => { console.log('WhatsApp service on', PORT); initializeClient(); });
