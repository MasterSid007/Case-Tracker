/**
 * USCIS Tracker first-time setup.
 *
 * Creates the local data directory, generates VAPID keys for web push, and
 * creates .env from .env.example when needed.
 */

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const ENV_FILE = path.join(__dirname, '..', '.env');
const ENV_EXAMPLE = path.join(__dirname, '..', '.env.example');
const VAPID_FILE = path.join(__dirname, '..', 'data', 'vapid.json');
const DATA_DIR = path.join(__dirname, '..', 'data');

console.log('');
console.log('USCIS Tracker setup');
console.log('===================');
console.log('');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Created data/ directory');
}

if (!fs.existsSync(VAPID_FILE)) {
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), 'utf-8');
  console.log('Generated VAPID keys at data/vapid.json');
} else {
  console.log('VAPID keys already exist');
}

if (!fs.existsSync(ENV_FILE)) {
  if (fs.existsSync(ENV_EXAMPLE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log('Created .env from .env.example');
  } else {
    const defaultEnv = 'PORT=3456\nVAPID_EMAIL=admin@example.com\n';
    fs.writeFileSync(ENV_FILE, defaultEnv, 'utf-8');
    console.log('Created .env with defaults');
  }
} else {
  console.log('.env already exists');
}

console.log('');
console.log('Setup complete. Run the app with: npm start');
console.log('');
