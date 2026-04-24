# 🇺🇸 USCIS Case Status Tracker

A self-hosted, automated USCIS case status tracker with a sleek dark-mode dashboard, desktop & push notifications, and intelligent case journey visualization.

Track multiple USCIS receipt numbers, get notified instantly when a status changes, and monitor your immigration case progress — all from a beautiful web dashboard accessible from any device.


## ✨ Features

- **Automated Status Checking** — Periodically scrapes USCIS.gov using a real Chrome browser to bypass Cloudflare protections
- **Smart Journey Progress Bar** — Automatically detects form type (I-485, I-765, N-400, etc.) and shows a tailored progress pipeline
- **Desktop Notifications** — Native OS popups when a case status changes
- **Web Push Notifications** — Get alerts on your phone via PWA push (works on Android & iOS)
- **Neighborhood Scanner** — Check the status of nearby receipt numbers to gauge processing speed
- **Backup & Restore** — Export/import your tracking data as JSON
- **Password-Protected Dashboard** — Secure access when exposed to the internet
- **Mobile-First Design** — Fully responsive bento-grid layout, installable as a PWA
- **Dark Mode** — Sleek, premium dark theme out of the box

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Google Chrome](https://www.google.com/chrome/) installed on the host machine

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/uscis-tracker.git
cd uscis-tracker

# Install dependencies
npm install

# Run first-time setup (creates .env and VAPID keys)
npm run setup

# Edit your password
# Open .env and change DASHBOARD_PASSWORD

# Start the tracker
npm start
```

The dashboard will be available at **http://localhost:3456**.

### Optional: Install Playwright Browser

If Chrome is not available on your system, you can install a bundled Chromium:

```bash
npm run install-browser
```

## 🔧 Configuration

All configuration is done through the `.env` file:

| Variable | Default | Description |
|---|---|---|
| `DASHBOARD_PASSWORD` | `changeme` | Password to access the dashboard |
| `PORT` | `3456` | Server port |
| `VAPID_PUBLIC_KEY` | *(auto-generated)* | Web Push public key |
| `VAPID_PRIVATE_KEY` | *(auto-generated)* | Web Push private key |

## 🌐 Remote Access

To access the tracker from your phone or another network, you can use a tunneling service:

### Using ngrok (recommended)

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3456 --url your-domain.ngrok-free.dev
```

### Using Cloudflare Tunnel

```bash
cloudflared tunnel --url http://localhost:3456
```

## 📱 Mobile PWA Setup

1. Open the dashboard URL on your phone's browser
2. Tap **"Add to Home Screen"** (Safari) or **"Install App"** (Chrome)
3. Open the installed app and go to **Settings → Enable Native Push**
4. You'll now receive push notifications on status changes

## 🏗️ Architecture

```
uscis-tracker/
├── server.js            # Express API server + scheduler
├── lib/
│   ├── scraper.js       # Playwright-based USCIS scraper
│   ├── storage.js       # JSON file-based persistence
│   └── notifier.js      # Desktop notification handler
├── public/
│   ├── index.html       # Dashboard SPA
│   ├── css/style.css    # Dark-mode bento-grid styles
│   ├── js/app.js        # Frontend logic + journey pipeline
│   ├── sw.js            # Service worker for push
│   └── manifest.json    # PWA manifest
├── data/                # Runtime data (gitignored)
│   ├── cases.json       # Tracked cases & history
│   └── vapid.json       # VAPID keys for push
├── scripts/
│   └── setup.js         # First-time setup script
├── .env.example         # Example environment config
└── package.json
```

## 🔒 How It Works

1. **Scraper** launches a real Chrome browser via Playwright's CDP (Chrome DevTools Protocol) to navigate USCIS.gov
2. Chrome's existing session cookies help bypass Cloudflare's Turnstile challenge automatically
3. The scraper extracts the case status from the results page using multiple fallback strategies
4. If a status change is detected, desktop + push notifications fire immediately
5. All data is stored locally in a JSON file — no external database required

## 📋 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/cases` | List all tracked cases |
| `POST` | `/api/cases` | Add a new case |
| `DELETE` | `/api/cases/:id` | Remove a case |
| `POST` | `/api/check/:id` | Check a single case |
| `POST` | `/api/check-all` | Check all cases |
| `POST` | `/api/check-neighbors/:receipt` | Batch-scan nearby receipts |
| `GET` | `/api/settings` | Get settings |
| `PUT` | `/api/settings` | Update settings |
| `GET` | `/api/logs` | Get activity logs |
| `GET` | `/api/status` | Get server status |

All API endpoints require the `Authorization` header set to your dashboard password.

## ⚠️ Disclaimer

This tool scrapes USCIS.gov for personal use. It includes respectful delays between checks to avoid overloading their servers. Please use responsibly and do not abuse the service.

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
