# WhatsApp Integration Setup Guide

## Overview
This WhatsApp integration allows you to connect WhatsApp Web to your Posnic application using QR code authentication. Sessions persist until logout, enabling automated WhatsApp messaging capabilities.

## Prerequisites
- Node.js 16+ installed
- Chrome/Chromium browser (for Puppeteer)
- Active WhatsApp account

## Installation Steps

### 1. Install Required NPM Packages

Navigate to the ApiV2 directory and install the required packages:

```bash
cd d:\ApiV2
npm install whatsapp-web.js qrcode
```

### 2. Server Restart

After installing the packages, restart your Node.js server:

```bash
npm run dev
# or
npm start
```

### 3. Frontend Access

The WhatsApp Connection tab is now available in:
- Settings → WhatsApp Connection

## How to Use

### Connecting WhatsApp

1. **Navigate to Settings**
   - Go to Settings page
   - Click on "WhatsApp Connection" tab

2. **Enter Device ID**
   - Enter a unique device identifier (e.g., `device_001`, `branch_main`, etc.)
   - This ID is used to maintain separate sessions for different devices/branches

3. **Click "Connect WhatsApp"**
   - A QR code will be generated within a few seconds
   - The QR code will be displayed on the screen

4. **Scan QR Code**
   - Open WhatsApp on your phone
   - Go to Settings → Linked Devices
   - Tap "Link a Device"
   - Scan the QR code displayed on screen

5. **Connection Established**
   - Once scanned, the connection status will change to "Connected"
   - The session will remain active until you disconnect

### Disconnecting WhatsApp

1. Click the "Disconnect" button
2. Confirm the disconnection
3. The session will be terminated and you'll need to scan QR code again to reconnect

## API Endpoints

The following API endpoints are available:

### Initialize Connection
```
POST /api/whatsapp/initialize
Body: { device_id: "device_001" }
```

### Get QR Code
```
GET /api/whatsapp/getQRCode?device_id=device_001
```

### Get Connection Status
```
GET /api/whatsapp/getStatus?device_id=device_001
```

### Send Message
```
POST /api/whatsapp/sendMessage
Body: {
  device_id: "device_001",
  phone_number: "919876543210",
  message: "Hello from Posnic!"
}
```

### Logout/Disconnect
```
POST /api/whatsapp/logout
Body: { device_id: "device_001" }
```

## Session Persistence

- Sessions are stored in `.wwebjs_auth` directory
- Sessions persist across server restarts
- Each device_id + branch_id combination has its own session
- Sessions remain active until explicitly disconnected

## Troubleshooting

### QR Code Not Generating
- Check if `whatsapp-web.js` and `qrcode` packages are installed
- Check server logs for errors
- Ensure Chrome/Chromium is installed on the server

### Connection Timeout
- QR codes expire after 60 seconds
- Click "Connect WhatsApp" again to generate a new QR code

### Session Lost
- If session is lost, simply reconnect by scanning QR code again
- Check `.wwebjs_auth` directory permissions

### Puppeteer Issues on Linux
If running on Linux server, you may need to install additional dependencies:

```bash
sudo apt-get install -y \
  gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 \
  libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 \
  libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates \
  fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget
```

## Security Notes

- Device IDs should be unique per device/branch
- Sessions are stored locally on the server
- WhatsApp sessions are encrypted by WhatsApp Web protocol
- Only authorized users with access to Settings can manage connections

## Files Modified/Created

### Backend (ApiV2)
- `src/services/whatsapp.service.js` - WhatsApp service
- `src/controllers/whatsapp.controller.js` - API controller
- `src/routes/whatsapp.routes.js` - API routes
- `src/routes/index.js` - Added WhatsApp routes

### Frontend (d:\frontend and c:\dev\frontend)
- `modules/settings_write.html` - Added WhatsApp Connection tab
- `static/script/js/modules/js/whatsapp.js` - Frontend JavaScript

## Support

For issues or questions, check:
1. Server logs for backend errors
2. Browser console for frontend errors
3. `.wwebjs_auth` directory for session files
