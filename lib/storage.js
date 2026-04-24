const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEGACY_FILE = path.join(DATA_DIR, 'cases.json');
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');

const DEFAULT_DATA = {
  cases: [],
  subscriptions: [],
  settings: {
    checkIntervalHours: 4,
    notificationsEnabled: true,
    autoCheckEnabled: true
  },
  batchCache: {}
};

class Storage {
  constructor() {
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  // Hash a password into a short user identifier
  static getUserHash(password) {
    return crypto.createHash('sha256').update(password).digest('hex').substring(0, 16);
  }

  _userFile(userHash) {
    return path.join(DATA_DIR, `user_${userHash}.json`);
  }

  // Load data for a specific user
  loadUser(userHash) {
    const file = this._userFile(userHash);
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        const data = JSON.parse(raw);
        data.cases = data.cases || [];
        data.subscriptions = data.subscriptions || [];
        data.batchCache = data.batchCache || {};
        data.settings = { ...DEFAULT_DATA.settings, ...(data.settings || {}) };
        return data;
      }
    } catch (err) {
      console.error(`Error loading user data (${userHash}):`, err.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  // Save data for a specific user
  saveUser(userHash, data) {
    this._ensureDir();
    const file = this._userFile(userHash);
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(temp, file);
  }

  // Check if a user data file exists
  userExists(userHash) {
    return fs.existsSync(this._userFile(userHash));
  }

  // Migrate legacy cases.json to a user-specific file
  migrateLegacy(userHash) {
    if (!fs.existsSync(LEGACY_FILE)) return false;
    if (this.userExists(userHash)) return false;
    try {
      const raw = fs.readFileSync(LEGACY_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.cases && data.cases.length > 0) {
        this.saveUser(userHash, data);
        // Rename legacy file to mark as migrated
        fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated');
        return true;
      }
    } catch {}
    return false;
  }

  // ─── Share token management ───
  loadShares() {
    try {
      if (fs.existsSync(SHARES_FILE)) {
        return JSON.parse(fs.readFileSync(SHARES_FILE, 'utf-8'));
      }
    } catch {}
    return {}; // { token: userHash }
  }

  saveShares(shares) {
    this._ensureDir();
    const temp = SHARES_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(shares, null, 2), 'utf-8');
    fs.renameSync(temp, SHARES_FILE);
  }

  // Backward compat: load() and save() use legacy file
  load() {
    try {
      if (fs.existsSync(LEGACY_FILE)) {
        const raw = fs.readFileSync(LEGACY_FILE, 'utf-8');
        const data = JSON.parse(raw);
        data.cases = data.cases || [];
        data.subscriptions = data.subscriptions || [];
        data.batchCache = data.batchCache || {};
        data.settings = { ...DEFAULT_DATA.settings, ...(data.settings || {}) };
        return data;
      }
    } catch (err) {
      console.error('Error loading data file, using defaults:', err.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  save(data) {
    this._ensureDir();
    const temp = LEGACY_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(temp, LEGACY_FILE);
  }
}

module.exports = { Storage };
