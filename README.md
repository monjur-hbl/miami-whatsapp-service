# Miami Beach Resort - WhatsApp Service

A WhatsApp Web service that allows sending booking confirmations and invoices directly from the dashboard.

## Features

- 📱 QR Code scanning for WhatsApp connection
- 💬 Send messages directly to guests
- 📄 Send PDF invoices via WhatsApp
- 🔄 Auto-reconnect on disconnection

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/status` | GET | Connection status + QR code |
| `/qr` | GET | QR code page (auto-refreshes) |
| `/send` | POST | Send text message |
| `/send-pdf` | POST | Send message with PDF |
| `/logout` | POST | Disconnect WhatsApp |
| `/restart` | POST | Restart client |

## Deploy to Google Cloud Run

### Option 1: Using Cloud Console (Recommended)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select project `beds24-483408`
3. Go to **Cloud Run** → **Create Service**
4. Click **Continuously deploy from a repository**
5. Connect to GitHub repo: `monjur-hbl/miami-whatsapp-service`
6. Configure:
   - Region: `us-central1`
   - CPU: `1`
   - Memory: `1 GiB`
   - Min instances: `1` (important for persistent connection)
   - Max instances: `1`
   - Allow unauthenticated invocations: ✅
7. Click **Create**

### Option 2: Using gcloud CLI

```bash
# Clone the repo
git clone https://github.com/monjur-hbl/miami-whatsapp-service.git
cd miami-whatsapp-service

# Authenticate
gcloud auth login
gcloud config set project beds24-483408

# Build and deploy
gcloud builds submit --config cloudbuild.yaml
```

## Usage

Once deployed, the service URL will be something like:
`https://whatsapp-service-XXXXX-uc.a.run.app`

### Connect WhatsApp

1. Open `/qr` endpoint in browser
2. Scan QR code with WhatsApp on your phone
3. Once connected, status changes to "connected"

### Send Message

```bash
curl -X POST https://YOUR-SERVICE-URL/send \
  -H "Content-Type: application/json" \
  -d '{"phone": "01977086726", "message": "Hello from Miami Beach Resort!"}'
```

## Important Notes

⚠️ **Session Persistence**: Cloud Run containers can restart, which will require re-scanning the QR code. For production, consider:
- Using Cloud Run with `--min-instances=1` to keep always running
- Or deploying to Compute Engine for true persistence

## Environment

- Node.js 18+
- Puppeteer with Chromium
- whatsapp-web.js library
