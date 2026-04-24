require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');
const { Storage } = require('./lib/storage');
const { USCISScraper } = require('./lib/scraper');
const { Notifier } = require('./lib/notifier');

// ─── Configuration ───────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3456;
const VAPID_EMAIL = (() => {
  const raw = process.env.VAPID_EMAIL || 'admin@example.com';
  return raw.startsWith('mailto:') ? raw : `mailto:${raw}`;
})();

// ─── Tuning Constants ───────────────────────────────────────────────
const MAX_LOG_ENTRIES = 200;
const BATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH_DELAY_BASE_MS = 3000;
const BATCH_DELAY_JITTER_MS = 3000;
const CHECK_ALL_DELAY_BASE_MS = 5000;
const CHECK_ALL_DELAY_JITTER_MS = 5000;
const MAX_RESTORE_CASES = 100;

// ─── Instances ───────────────────────────────────────────────────────
const app = express();
const storage = new Storage();
const notifier = new Notifier();

let logs = [];
let isChecking = false;
let cronJob = null;
let lastCheckTime = null;
let nextCheckTime = null;

function addLog(message, type = 'info') {
  const entry = { message, type, timestamp: new Date().toISOString() };
  logs.unshift(entry);
  if (logs.length > MAX_LOG_ENTRIES) logs = logs.slice(0, MAX_LOG_ENTRIES);
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
  console.log(`${icon} [${new Date().toLocaleTimeString()}] ${message}`);
}

const scraper = new USCISScraper((msg) => addLog(msg));

// ─── Web Push Setup (Auto-Generate VAPID Keys) ──────────────────────
const VAPID_FILE = path.join(__dirname, 'data', 'vapid.json');

function loadOrCreateVapidKeys() {
  // 1. Try env vars first
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  }

  // 2. Try vapid.json file
  try {
    if (fs.existsSync(VAPID_FILE)) {
      return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
    }
  } catch {}

  // 3. Auto-generate and save
  addLog('Generating new VAPID keys for Web Push...', 'info');
  const keys = webpush.generateVAPIDKeys();
  const dataDir = path.dirname(VAPID_FILE);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), 'utf-8');
  addLog('VAPID keys generated and saved to data/vapid.json', 'success');
  return keys;
}

let vapidKeys = null;
try {
  vapidKeys = loadOrCreateVapidKeys();
  webpush.setVapidDetails(
    VAPID_EMAIL,
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
} catch (err) {
  addLog('Web Push setup failed. Push notifications disabled.', 'warning');
}

async function sendWebPush(title, body, data) {
  if (!vapidKeys) return;
  if (!data || !data.subscriptions || data.subscriptions.length === 0) return;
  const payload = JSON.stringify({ title, body });

  let invalidSubs = [];
  for (let i = 0; i < data.subscriptions.length; i++) {
    try {
      await webpush.sendNotification(data.subscriptions[i], payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        invalidSubs.push(data.subscriptions[i].endpoint);
      } else {
        console.error('Push error:', err);
      }
    }
  }

  if (invalidSubs.length > 0) {
    data.subscriptions = data.subscriptions.filter(s => !invalidSubs.includes(s.endpoint));
  }
}

// ─── Middleware ──────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Serve static files publicly
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting for auth (max 20 failed attempts per 15 min per IP)
const authAttempts = new Map();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 20;

function rateLimit(clientIp) {
  const now = Date.now();
  const attempts = authAttempts.get(clientIp) || { count: 0, firstAttempt: now };
  if (now - attempts.firstAttempt > AUTH_WINDOW_MS) {
    attempts.count = 0;
    attempts.firstAttempt = now;
  }
  if (attempts.count > AUTH_MAX_ATTEMPTS) return false;
  attempts.count++;
  authAttempts.set(clientIp, attempts);
  return true;
}

// ─── Auth: Login (verify account exists) ───────────────────────────
app.post('/auth/login', (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress;
  if (!rateLimit(clientIp)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const userHash = Storage.getUserHash(password);

  // Try legacy migration first
  storage.migrateLegacy(userHash);

  if (storage.userExists(userHash)) {
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'No account found with this password.' });
});

// ─── Auth: Register (create new account) ───────────────────────────
app.post('/auth/register', (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress;
  if (!rateLimit(clientIp)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const userHash = Storage.getUserHash(password);
  if (storage.userExists(userHash)) {
    return res.status(409).json({ error: 'Account already exists. Try signing in.' });
  }

  // Create the user data file
  const data = storage.loadUser(userHash);
  storage.saveUser(userHash, data);
  addLog('New user account created');
  return res.json({ success: true });
});

// ─── API auth middleware ───────────────────────────────────────────
app.use('/api', (req, res, next) => {
  const token = req.headers['authorization'] || '';

  if (!token || token.length < 1) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userHash = Storage.getUserHash(token);

  if (!storage.userExists(userHash)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.userHash = userHash;
  next();
});

// ─── API: Cases ─────────────────────────────────────────────────────
app.get('/api/cases', (req, res) => {
  const data = storage.loadUser(req.userHash);
  res.json(data.cases);
});

app.post('/api/cases', (req, res) => {
  const { receiptNumber, label } = req.body;

  if (!receiptNumber || typeof receiptNumber !== 'string') {
    return res.status(400).json({ error: 'Receipt number is required' });
  }

  const cleaned = receiptNumber.toUpperCase().replace(/[\s-]/g, '').trim();

  // Validate receipt number format (3 letters + 10 digits)
  if (!/^[A-Z]{3}\d{10}$/.test(cleaned)) {
    return res.status(400).json({
      error: 'Invalid receipt number format. It should be 3 letters followed by 10 digits (e.g., IOE1234567890)',
    });
  }

  const data = storage.loadUser(req.userHash);
  const existing = data.cases.find(c => c.receiptNumber === cleaned);
  if (existing) {
    return res.status(400).json({ error: 'This receipt number has already been added' });
  }

  const newCase = {
    id: uuidv4(),
    receiptNumber: cleaned,
    label: (label || '').trim(),
    status: null,
    statusDetail: null,
    lastChecked: null,
    lastChanged: null,
    addedAt: new Date().toISOString(),
    history: [],
  };

  data.cases.push(newCase);
  storage.saveUser(req.userHash, data);
  addLog(`Added case: ${cleaned}${newCase.label ? ` (${newCase.label})` : ''}`);
  res.json(newCase);
});

app.put('/api/cases/:id', (req, res) => {
  const data = storage.loadUser(req.userHash);
  const caseItem = data.cases.find(c => c.id === req.params.id);
  if (!caseItem) return res.status(404).json({ error: 'Case not found' });

  if (req.body.label !== undefined) {
    const label = String(req.body.label).trim().substring(0, 200);
    caseItem.label = label;
  }
  storage.saveUser(req.userHash, data);
  res.json(caseItem);
});

app.delete('/api/cases/:id', (req, res) => {
  const data = storage.loadUser(req.userHash);
  const index = data.cases.findIndex(c => c.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Case not found' });

  const removed = data.cases.splice(index, 1)[0];
  storage.saveUser(req.userHash, data);
  addLog(`Removed case: ${removed.receiptNumber}`);
  res.json({ success: true });
});

// ─── API: Check Status ─────────────────────────────────────────────
app.post('/api/check/:id', async (req, res) => {
  if (isChecking) {
    return res.status(429).json({ error: 'A check is already in progress. Please wait.' });
  }

  isChecking = true;

  const data = storage.loadUser(req.userHash);
  const caseItem = data.cases.find(c => c.id === req.params.id);
  if (!caseItem) {
    isChecking = false;
    return res.status(404).json({ error: 'Case not found' });
  }

  addLog(`Manual check for: ${caseItem.receiptNumber}`);

  try {
    const result = await scraper.checkStatus(caseItem.receiptNumber);

    if (result.success) {
      const changed = caseItem.status !== null && caseItem.status !== result.status;

      caseItem.history.push({
        status: result.status,
        statusDetail: result.detail,
        checkedAt: result.checkedAt,
      });

      if (changed) {
        caseItem.lastChanged = result.checkedAt;
        addLog(
          `⚡ STATUS CHANGED for ${caseItem.receiptNumber}: "${caseItem.status}" → "${result.status}"`,
          'success'
        );
        if (data.settings.notificationsEnabled) {
          notifier.notify(caseItem, result.status, caseItem.status);
          sendWebPush(
            `USCIS Update: ${caseItem.receiptNumber}`,
            `Status changed to: ${result.status}`,
            data
          );
        }
      } else {
        addLog(`No change for ${caseItem.receiptNumber}: "${result.status}"`);
      }

      caseItem.status = result.status;
      caseItem.statusDetail = result.detail;
      caseItem.lastChecked = result.checkedAt;

      storage.saveUser(req.userHash, data);
      res.json(caseItem);
    } else {
      addLog(`Failed: ${caseItem.receiptNumber} — ${result.error}`, 'error');
      res.status(500).json({ error: result.error });
    }
  } catch (err) {
    addLog(`Error: ${caseItem.receiptNumber} — ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  } finally {
    isChecking = false;
  }
});

app.post('/api/check-all', async (req, res) => {
  if (isChecking) {
    return res.status(429).json({ error: 'A check is already in progress. Please wait.' });
  }

  const userHash = req.userHash;
  res.json({ message: 'Check started for all cases' });
  await checkAllCasesForUser(userHash);
});

app.post('/api/test-notification', (req, res) => {
  addLog('User requested a test desktop notification');
  notifier.notifyInfo('Test Alert: Your USCIS Tracker notifications are working properly! 🇺🇸');
  const data = storage.loadUser(req.userHash);
  sendWebPush('Test Push', 'Your mobile Web Push notifications are working correctly! 🚀', data);
  storage.saveUser(req.userHash, data);
  res.json({ success: true });
});

// ─── API: Neighborhood Batch Checking ──────────────────────────────
app.post('/api/check-neighbors/:receipt', async (req, res) => {
  if (isChecking) {
    return res.status(429).json({ error: 'A background check is currently running. Please wait.' });
  }

  const receipt = req.params.receipt.toUpperCase().replace(/[\s-]/g, '').trim();
  if (!/^[A-Z]{3}\d{10}$/.test(receipt)) {
    return res.status(400).json({ error: 'Invalid receipt' });
  }

  const data = storage.loadUser(req.userHash);
  data.batchCache = data.batchCache || {};

  // Purge expired batch cache entries
  const now = Date.now();
  for (const key of Object.keys(data.batchCache)) {
    if (now - data.batchCache[key].timestamp >= BATCH_CACHE_TTL_MS) {
      delete data.batchCache[key];
    }
  }

  // Smart cache check
  const cached = data.batchCache[receipt];
  if (cached && (now - cached.timestamp < BATCH_CACHE_TTL_MS)) {
    return res.json({ cached: true, results: cached.results });
  }

  // Compute neighborhood (10 before, 10 after)
  const prefix = receipt.substring(0, 3);
  const numStr = receipt.substring(3);
  const coreNum = parseInt(numStr, 10);
  const neighbors = [];
  
  for (let i = coreNum - 10; i <= coreNum + 10; i++) {
    neighbors.push(prefix + String(i).padStart(10, '0'));
  }

  isChecking = true;
  addLog(`Initiated batch scan for neighborhood around ${receipt}`);

  // Stream results via chunked transfer
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const results = {};

  try {
    for (let i = 0; i < neighbors.length; i++) {
      const target = neighbors[i];
      res.write(JSON.stringify({ type: 'progress', target, index: i, total: neighbors.length }) + '\n');
      
      const scrapeResult = await scraper.checkStatus(target);
      if (scrapeResult.success) {
        results[target] = scrapeResult.status;
      } else {
        results[target] = 'Error';
      }

      // Jitter delay between checks (3-6s)
      if (i < neighbors.length - 1) {
        const waitMs = BATCH_DELAY_BASE_MS + Math.random() * BATCH_DELAY_JITTER_MS;
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    // Cache results
    data.batchCache[receipt] = { timestamp: Date.now(), results };
    storage.saveUser(req.userHash, data);
    res.write(JSON.stringify({ type: 'complete', results }) + '\n');

  } catch (err) {
    addLog(`Batch Error: ${err.message}`, 'error');
    res.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
  } finally {
    isChecking = false;
    res.end();
  }
});

// ─── API: Web Push ──────────────────────────────────────────────────
app.get('/api/vapidPublicKey', (req, res) => {
  if (!vapidKeys) return res.status(500).json({ error: 'Push not configured' });
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  const data = storage.loadUser(req.userHash);
  if (!data.subscriptions) data.subscriptions = [];
  if (!data.subscriptions.some(s => s.endpoint === subscription.endpoint)) {
    data.subscriptions.push(subscription);
    storage.saveUser(req.userHash, data);
    addLog('New device subscribed to push notifications', 'success');
  }
  res.status(201).json({});
});

app.delete('/api/subscribe', (req, res) => {
  const { endpoint } = req.body;
  const data = storage.loadUser(req.userHash);
  if (data.subscriptions) {
    data.subscriptions = data.subscriptions.filter(s => s.endpoint !== endpoint);
    storage.saveUser(req.userHash, data);
  }
  res.json({ success: true });
});

// ─── API: Settings ──────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const data = storage.loadUser(req.userHash);
  res.json(data.settings);
});

app.put('/api/settings', (req, res) => {
  const data = storage.loadUser(req.userHash);
  const newSettings = { ...data.settings };

  if (req.body.checkIntervalHours !== undefined) {
    const h = parseInt(req.body.checkIntervalHours);
    if (h >= 1 && h <= 24) newSettings.checkIntervalHours = h;
  }
  if (req.body.notificationsEnabled !== undefined) {
    newSettings.notificationsEnabled = !!req.body.notificationsEnabled;
  }
  if (req.body.autoCheckEnabled !== undefined) {
    newSettings.autoCheckEnabled = !!req.body.autoCheckEnabled;
  }

  data.settings = newSettings;
  storage.saveUser(req.userHash, data);
  setupScheduler(newSettings);
  res.json(newSettings);
});

app.post('/api/restore', (req, res) => {
  try {
    const incoming = req.body;
    if (!incoming || !Array.isArray(incoming.cases)) {
      return res.status(400).json({ error: 'Invalid backup format: expected { cases: [...] }' });
    }
    if (incoming.cases.length > MAX_RESTORE_CASES) {
      return res.status(400).json({ error: 'Backup exceeds maximum of 100 cases' });
    }
    // Validate each case has required fields
    for (const c of incoming.cases) {
      if (!c.receiptNumber || typeof c.receiptNumber !== 'string') {
        return res.status(400).json({ error: 'Invalid case data: missing receiptNumber' });
      }
      const cleaned = c.receiptNumber.toUpperCase().replace(/[\s-]/g, '').trim();
      if (!/^[A-Z]{3}\d{10}$/.test(cleaned)) {
        return res.status(400).json({ error: `Invalid receipt number format in backup: ${c.receiptNumber}` });
      }
      c.receiptNumber = cleaned;
    }
    const data = storage.loadUser(req.userHash);
    data.cases = incoming.cases;
    if (incoming.settings && typeof incoming.settings === 'object') {
      const safe = {};
      if (typeof incoming.settings.checkIntervalHours === 'number') safe.checkIntervalHours = incoming.settings.checkIntervalHours;
      if (typeof incoming.settings.notificationsEnabled === 'boolean') safe.notificationsEnabled = incoming.settings.notificationsEnabled;
      if (typeof incoming.settings.autoCheckEnabled === 'boolean') safe.autoCheckEnabled = incoming.settings.autoCheckEnabled;
      data.settings = { ...data.settings, ...safe };
    }
    storage.saveUser(req.userHash, data);
    addLog(`Database restored from backup. Loaded ${data.cases.length} case(s).`, 'success');
    res.json({ success: true, count: data.cases.length });
  } catch(err) {
    res.status(500).json({ error: 'Failed to parse backup' });
  }
});

// ─── API: Logs & Status ────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  res.json(logs);
});

app.get('/api/status', (req, res) => {
  res.json({
    isChecking,
    cronActive: cronJob !== null,
    lastCheckTime,
    nextCheckTime,
  });
});

// ─── Core: Check All Cases (per-user) ─────────────────────────────
async function checkAllCasesForUser(userHash) {
  if (isChecking) return;
  isChecking = true;

  const data = storage.loadUser(userHash);
  if (data.cases.length === 0) {
    addLog('No cases to check');
    isChecking = false;
    return;
  }

  addLog(`━━━ Checking ${data.cases.length} case(s) ━━━`);
  lastCheckTime = new Date().toISOString();

  for (let i = 0; i < data.cases.length; i++) {
    const caseItem = data.cases[i];

    try {
      const result = await scraper.checkStatus(caseItem.receiptNumber);

      if (result.success) {
        const changed = caseItem.status !== null && caseItem.status !== result.status;

        caseItem.history.push({
          status: result.status,
          statusDetail: result.detail,
          checkedAt: result.checkedAt,
        });

        if (changed) {
          caseItem.lastChanged = result.checkedAt;
          addLog(
            `⚡ STATUS CHANGED: ${caseItem.receiptNumber} — "${caseItem.status}" → "${result.status}"`,
            'success'
          );
          if (data.settings.notificationsEnabled) {
            notifier.notify(caseItem, result.status, caseItem.status);
            sendWebPush(
              `USCIS Update: ${caseItem.receiptNumber}`,
              `Status changed to: ${result.status}`,
              data
            );
          }
        } else {
          addLog(`✓ ${caseItem.receiptNumber}: "${result.status}" (no change)`);
        }

        caseItem.status = result.status;
        caseItem.statusDetail = result.detail;
        caseItem.lastChecked = result.checkedAt;
      } else {
        addLog(`✗ ${caseItem.receiptNumber}: ${result.error}`, 'error');
      }
    } catch (err) {
      addLog(`✗ ${caseItem.receiptNumber}: ${err.message}`, 'error');
    }

    // Respectful delay between case checks (5-10s)
    if (i < data.cases.length - 1) {
      const delay = CHECK_ALL_DELAY_BASE_MS + Math.random() * CHECK_ALL_DELAY_JITTER_MS;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  storage.saveUser(userHash, data);
  addLog(`━━━ Check complete ━━━`);
  isChecking = false;

  // Calculate next check time
  const settings = data.settings;
  if (settings.autoCheckEnabled) {
    nextCheckTime = new Date(
      Date.now() + settings.checkIntervalHours * 60 * 60 * 1000
    ).toISOString();
  }
}

// ─── API: Share ────────────────────────────────────────────────────
app.get('/api/share', (req, res) => {
  const data = storage.loadUser(req.userHash);
  const shareToken = data.settings.shareToken || null;
  res.json({ enabled: !!shareToken, token: shareToken });
});

app.post('/api/share', (req, res) => {
  const data = storage.loadUser(req.userHash);
  const shares = storage.loadShares();

  if (data.settings.shareToken) {
    // Disable sharing
    delete shares[data.settings.shareToken];
    delete data.settings.shareToken;
    storage.saveShares(shares);
    storage.saveUser(req.userHash, data);
    addLog('Sharing disabled');
    return res.json({ enabled: false, token: null });
  }

  // Enable sharing — generate a random token
  const token = crypto.randomBytes(16).toString('hex');
  data.settings.shareToken = token;
  shares[token] = req.userHash;
  storage.saveShares(shares);
  storage.saveUser(req.userHash, data);
  addLog('Sharing enabled');
  res.json({ enabled: true, token });
});

// ─── Public: Shared Status Page (no auth) ──────────────────────────
app.get('/s/:token', (req, res) => {
  const shares = storage.loadShares();
  const userHash = shares[req.params.token];
  if (!userHash) return res.status(404).send('Share link not found or expired.');

  const data = storage.loadUser(userHash);
  if (!data.settings.shareToken || data.settings.shareToken !== req.params.token) {
    return res.status(404).send('Share link not found or expired.');
  }

  // Build a minimal read-only status page
  const cases = data.cases.map(c => ({
    receipt: c.receiptNumber,
    label: c.label || '',
    status: c.status || 'Pending',
    lastChecked: c.lastChecked,
    lastChanged: c.lastChanged,
  }));

  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const rows = cases.map(c => `
    <div class="s-card">
      <div class="s-head"><span class="s-receipt">${esc(c.receipt)}</span>${c.label ? `<span class="s-label">${esc(c.label)}</span>` : ''}</div>
      <div class="s-status">${esc(c.status)}</div>
      <div class="s-time">${c.lastChecked ? 'Checked ' + new Date(c.lastChecked).toLocaleString() : 'Not checked yet'}</div>
    </div>`).join('');

  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shared Cases</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',-apple-system,sans-serif;background:#09090b;color:#fafafa;min-height:100vh;padding:24px}
.wrap{max-width:600px;margin:0 auto}.hdr{text-align:center;margin-bottom:32px}.hdr h1{font-size:20px;font-weight:700;margin-bottom:4px}
.hdr p{font-size:13px;color:#71717a}.s-card{background:rgba(17,17,19,0.7);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px;margin-bottom:10px}
.s-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}.s-receipt{font-family:monospace;font-size:13px;font-weight:600;letter-spacing:0.3px}
.s-label{font-size:12px;color:#a1a1aa}.s-status{font-size:14px;color:#a1a1aa;margin-bottom:4px}.s-time{font-size:11px;color:#71717a}
</style></head><body><div class="wrap"><div class="hdr"><h1>USCIS Case Status</h1><p>${cases.length} case(s) shared</p></div>${rows || '<p style="text-align:center;color:#71717a">No cases tracked yet.</p>'}</div></body></html>`);
});

// ─── Scheduler ──────────────────────────────────────────────────────
function setupScheduler(settings) {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    nextCheckTime = null;
  }

  if (settings.autoCheckEnabled) {
    const hours = settings.checkIntervalHours || 4;
    const cronExpr = `0 */${hours} * * *`;

    cronJob = cron.schedule(cronExpr, () => {
      addLog(`⏰ Scheduled check triggered (every ${hours}h)`);
      checkAllUsersScheduled();
    });

    nextCheckTime = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    addLog(`Auto-check enabled: every ${hours} hour(s)`);
  } else {
    addLog('Auto-check disabled');
  }
}

// ─── Scheduled check across all user files ─────────────────────────
async function checkAllUsersScheduled() {
  const dataDir = path.join(__dirname, 'data');
  try {
    const files = fs.readdirSync(dataDir).filter(f => f.startsWith('user_') && f.endsWith('.json'));
    for (const file of files) {
      const userHash = file.replace('user_', '').replace('.json', '');
      const data = storage.loadUser(userHash);
      if (data.settings.autoCheckEnabled && data.cases.length > 0) {
        await checkAllCasesForUser(userHash);
      }
    }
  } catch (err) {
    addLog(`Scheduled check error: ${err.message}`, 'error');
  }
}

// ─── Start Server ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║                                                    ║');
  console.log('║     🇺🇸  USCIS Case Status Tracker  🇺🇸             ║');
  console.log('║                                                    ║');
  console.log(`║     Dashboard: http://localhost:${PORT}               ║`);
  console.log('║                                                    ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');

  // Use default scheduler settings on startup
  setupScheduler({ autoCheckEnabled: true, checkIntervalHours: 4 });
  addLog('Server started — multi-user mode active');
});
