/**
 * USCIS Tracker — First-Time Setup Script
 * 
 * Generates VAPID keys and creates the .env file if it doesn't exist.
 * Run with: npm run setup
 */

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const ENV_FILE = path.join(__dirname, '..', '.env');
const ENV_EXAMPLE = path.join(__dirname, '..', '.env.example');
const VAPID_FILE = path.join(__dirname, '..', 'data', 'vapid.json');
const DATA_DIR = path.join(__dirname, '..', 'data');

console.log('');
console.log('🔧 USCIS Tracker — Setup');
console.log('========================');
console.log('');

// 1. Create data directory
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('✅ Created data/ directory');
}

// 2. Generate VAPID keys
if (!fs.existsSync(VAPID_FILE)) {
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), 'utf-8');
  console.log('✅ Generated VAPID keys → data/vapid.json');
} else {
  console.log('⏭️  VAPID keys already exist');
}

// 3. Create .env from example if needed
if (!fs.existsSync(ENV_FILE)) {
  if (fs.existsSync(ENV_EXAMPLE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    console.log('✅ Created .env from .env.example');
    console.log('   ⚠️  Edit .env to set your DASHBOARD_PASSWORD!');
  } else {
    const defaultEnv = '# Dashboard login password\nDASHBOARD_PASSWORD=changeme\n\n# Server port\nPORT=3456\n';
    fs.writeFileSync(ENV_FILE, defaultEnv, 'utf-8');
    console.log('✅ Created .env with defaults');
    console.log('   ⚠️  Edit .env to set your DASHBOARD_PASSWORD!');
  }
} else {
  console.log('⏭️  .env already exists');
}

console.log('');
console.log('🚀 Setup complete! Run the app with: npm start');
console.log('');
