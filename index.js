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
let connectionStatus = 'disconnected'; // disconnected, qr_ready, connecting, connected
let clientInfo = null;
let lastError = null;

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '/tmp/whatsapp-session'
    }),
    puppeteer: {
        headless: true,
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

// Authenticated event
client.on('authenticated', () => {
    console.log('WhatsApp authenticated');
    connectionStatus = 'connecting';
});

// Auth failure
client.on('auth_failure', (msg) => {
    console.error('Auth failure:', msg);
    connectionStatus = 'disconnected';
    lastError = 'Authentication failed: ' + msg;
});

// Disconnected event
client.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected:', reason);
    connectionStatus = 'disconnected';
    clientInfo = null;
    lastError = reason;
    
    // Try to reconnect after 5 seconds
    setTimeout(() => {
        console.log('Attempting to reconnect...');
        client.initialize();
    }, 5000);
});

// Loading screen
client.on('loading_screen', (percent, message) => {
    console.log('Loading:', percent, '%', message);
    connectionStatus = 'connecting';
});

// Initialize client
console.log('Initializing WhatsApp client...');
client.initialize();

// ============ API ENDPOINTS ============

// Health check
app.get('/', (req, res) => {
    res.json({
        service: 'Miami Beach Resort WhatsApp Service',
        status: connectionStatus,
        timestamp: new Date().toISOString()
    });
});

// Get connection status and QR code
app.get('/status', (req, res) => {
    res.json({
        status: connectionStatus,
        qrCode: qrCodeData,
        connectedAs: clientInfo ? {
            name: clientInfo.pushname,
            phone: clientInfo.wid?.user
        } : null,
        lastError: lastError
    });
});

// Get QR code image directly
app.get('/qr', (req, res) => {
    if (qrCodeData) {
        // Send as HTML page with auto-refresh
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp QR Code</title>
                <meta http-equiv="refresh" content="5">
                <style>
                    body { 
                        background: #111b21; 
                        color: white; 
                        font-family: Arial, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                    }
                    img { border-radius: 10px; }
                    p { color: #8696a0; margin-top: 20px; }
                </style>
            </head>
            <body>
                <h2>📱 Scan with WhatsApp</h2>
                <img src="${qrCodeData}" alt="QR Code" />
                <p>Waiting for scan... (auto-refreshes)</p>
            </body>
            </html>
        `);
    } else if (connectionStatus === 'connected') {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Connected</title>
                <style>
                    body { 
                        background: #111b21; 
                        color: white; 
                        font-family: Arial, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                    }
                    .success { color: #25D366; font-size: 60px; }
                </style>
            </head>
            <body>
                <div class="success">✅</div>
                <h2>WhatsApp Connected!</h2>
                <p>Connected as: ${clientInfo?.pushname || 'Unknown'} (${clientInfo?.wid?.user || ''})</p>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Loading</title>
                <meta http-equiv="refresh" content="3">
                <style>
                    body { 
                        background: #111b21; 
                        color: white; 
                        font-family: Arial, sans-serif;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                    }
                </style>
            </head>
            <body>
                <h2>⏳ Loading WhatsApp...</h2>
                <p>Status: ${connectionStatus}</p>
                <p>Please wait... (auto-refreshes)</p>
            </body>
            </html>
        `);
    }
});

// Send message
app.post('/send', async (req, res) => {
    try {
        const { phone, message } = req.body;
        
        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Phone and message are required' });
        }
        
        if (connectionStatus !== 'connected') {
            return res.status(503).json({ success: false, error: 'WhatsApp not connected. Please scan QR code first.' });
        }
        
        // Format phone number (remove +, ensure country code)
        let formattedPhone = phone.replace(/[^0-9]/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '88' + formattedPhone; // Bangladesh
        } else if (!formattedPhone.startsWith('88') && formattedPhone.length === 11) {
            formattedPhone = '88' + formattedPhone;
        }
        
        // Add @c.us suffix for WhatsApp
        const chatId = formattedPhone + '@c.us';
        
        console.log('Sending message to:', chatId);
        
        // Check if number is registered on WhatsApp
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.status(400).json({ success: false, error: 'This phone number is not registered on WhatsApp' });
        }
        
        // Send message
        const result = await client.sendMessage(chatId, message);
        
        console.log('Message sent:', result.id._serialized);
        
        res.json({
            success: true,
            messageId: result.id._serialized,
            to: formattedPhone
        });
        
    } catch (error) {
        console.error('Send error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send message with PDF attachment
app.post('/send-pdf', async (req, res) => {
    try {
        const { phone, message, pdfBase64, filename } = req.body;
        
        if (!phone) {
            return res.status(400).json({ success: false, error: 'Phone is required' });
        }
        
        if (connectionStatus !== 'connected') {
            return res.status(503).json({ success: false, error: 'WhatsApp not connected' });
        }
        
        // Format phone number
        let formattedPhone = phone.replace(/[^0-9]/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '88' + formattedPhone;
        } else if (!formattedPhone.startsWith('88') && formattedPhone.length === 11) {
            formattedPhone = '88' + formattedPhone;
        }
        
        const chatId = formattedPhone + '@c.us';
        
        // Check if registered
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.status(400).json({ success: false, error: 'Phone not on WhatsApp' });
        }
        
        // Send text message first if provided
        if (message) {
            await client.sendMessage(chatId, message);
        }
        
        // Send PDF if provided
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

// Logout/disconnect
app.post('/logout', async (req, res) => {
    try {
        await client.logout();
        connectionStatus = 'disconnected';
        clientInfo = null;
        qrCodeData = null;
        res.json({ success: true, message: 'Logged out' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Restart client
app.post('/restart', async (req, res) => {
    try {
        connectionStatus = 'disconnected';
        qrCodeData = null;
        await client.destroy();
        setTimeout(() => {
            client.initialize();
        }, 2000);
        res.json({ success: true, message: 'Restarting...' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`WhatsApp service running on port ${PORT}`);
});
