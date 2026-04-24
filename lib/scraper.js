const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { exec, execSync } = require('child_process');

const USCIS_URL = 'https://egov.uscis.gov/casestatus/landing.do';
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'data', 'screenshots');
const CHROME_PROFILE_DIR = path.join(__dirname, '..', 'data', 'chrome-profile');
const CDP_PORT = 9223; // Use non-standard port to avoid conflicts

class USCISScraper {
  constructor(logger) {
    this.log = logger || console.log;
    this._ensureDirs();
  }

  _ensureDirs() {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(CHROME_PROFILE_DIR)) {
      fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
    }
  }

  /**
   * Find Chrome executable on the system
   */
  _findChrome() {
    const possiblePaths = [
      process.env['PROGRAMFILES'] + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
      process.env['LOCALAPPDATA'] + '\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];

    for (const p of possiblePaths) {
      if (p && fs.existsSync(p)) return p;
    }

    // Try 'where' command as fallback
    try {
      const result = execSync('where chrome', { encoding: 'utf-8', timeout: 5000 }).trim();
      if (result) return result.split('\n')[0].trim();
    } catch {}

    return null;
  }

  /**
   * Check if Chrome is already running with remote debugging on our port
   */
  async _isChromeRunning() {
    try {
      const response = await fetch(`http://localhost:${CDP_PORT}/json/version`);
      if (response.ok) return true;
    } catch {}
    return false;
  }

  /**
   * Launch a dedicated Chrome instance with remote debugging enabled.
   * Uses a separate profile directory so it doesn't interfere with your normal Chrome.
   */
  async _launchChrome() {
    const chromePath = this._findChrome();
    if (!chromePath) {
      throw new Error(
        'Google Chrome not found. Please install Chrome or set the path manually.'
      );
    }

    this.log('Launching Chrome with remote debugging...');

    // Launch Chrome minimized with remote debugging
    const args = [
      `"${chromePath}"`,
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir="${CHROME_PROFILE_DIR}"`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-translate',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      `--window-size=1280,900`,
      '--window-position=0,0',
      'about:blank',
    ];

    // Spawn Chrome process detached
    const child = exec(args.join(' '), { windowsHide: false });
    child.unref();

    // Wait for Chrome to be ready
    for (let i = 0; i < 30; i++) {
      await this._sleep(500);
      if (await this._isChromeRunning()) {
        this.log('Chrome is ready');
        return;
      }
    }

    throw new Error('Chrome failed to start with remote debugging. Timed out after 15s.');
  }

  /**
   * Connect Playwright to the running Chrome instance
   */
  async _connect() {
    // If Chrome isn't running with debugging, launch it
    if (!(await this._isChromeRunning())) {
      await this._launchChrome();
    }

    const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    return browser;
  }

  /**
   * Check the status of a single USCIS receipt number.
   * Returns { success, status, detail, checkedAt, error, screenshotPath }
   */
  async checkStatus(receiptNumber) {
    let browser = null;
    let page = null;

    try {
      browser = await this._connect();
      const context = browser.contexts()[0] || await browser.newContext();
      page = await context.newPage();

      this.log(`Navigating to USCIS for ${receiptNumber}...`);

      // Navigate to the case status page
      await page.goto(USCIS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for page to fully render
      await this._sleep(2000 + Math.random() * 1000);

      // Check for Cloudflare challenge
      const pageContent = await page.content();
      if (
        pageContent.includes('Verify you are human') ||
        pageContent.includes('cf-turnstile') ||
        pageContent.includes('Just a moment')
      ) {
        this.log('⚠ Cloudflare challenge detected. Waiting for it to resolve...');

        // Wait up to 30 seconds for the challenge to auto-resolve
        // (Since we're using a real Chrome, Turnstile often auto-passes)
        let resolved = false;
        for (let i = 0; i < 30; i++) {
          await this._sleep(1000);
          const content = await page.content();
          if (
            !content.includes('Verify you are human') &&
            !content.includes('cf-turnstile') &&
            !content.includes('Just a moment')
          ) {
            resolved = true;
            break;
          }
        }

        if (!resolved) {
          // Take screenshot for debugging
          const ssPath = await this._screenshot(page, `challenge_${receiptNumber}`);
          return {
            success: false,
            error: 'Cloudflare challenge could not be resolved automatically. Please open Chrome manually, visit https://egov.uscis.gov/casestatus/landing.do, solve the challenge, then try again. The browser will remember you.',
            checkedAt: new Date().toISOString(),
            screenshotPath: ssPath,
          };
        }

        this.log('Cloudflare challenge resolved!');
      }

      // Try to find and fill the receipt number input
      const inputSelector = await this._findInput(page);
      if (!inputSelector) {
        const ssPath = await this._screenshot(page, `no_input_${receiptNumber}`);
        return {
          success: false,
          error: 'Could not find the receipt number input field. USCIS may have changed their page layout.',
          checkedAt: new Date().toISOString(),
          screenshotPath: ssPath,
        };
      }

      // Clear the input and type receipt number with human-like delays
      await page.click(inputSelector);
      await page.fill(inputSelector, '');
      await this._sleep(300 + Math.random() * 300);

      // Type slowly like a human
      for (const char of receiptNumber) {
        await page.type(inputSelector, char, { delay: 50 + Math.random() * 80 });
      }

      await this._sleep(500 + Math.random() * 500);

      // Find and click the submit button
      const submitSelector = await this._findSubmitButton(page);
      if (!submitSelector) {
        const ssPath = await this._screenshot(page, `no_button_${receiptNumber}`);
        return {
          success: false,
          error: 'Could not find the Check Status button. USCIS may have changed their page layout.',
          checkedAt: new Date().toISOString(),
          screenshotPath: ssPath,
        };
      }

      await page.click(submitSelector);

      // Wait for results to load
      await this._sleep(3000 + Math.random() * 2000);

      // Wait for navigation or content change
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      } catch {}

      await this._sleep(1000);

      // Check for Cloudflare again after submission
      const postContent = await page.content();
      if (
        postContent.includes('Verify you are human') ||
        postContent.includes('cf-turnstile') ||
        postContent.includes('Just a moment')
      ) {
        this.log('⚠ Cloudflare challenge after submission. Waiting...');
        for (let i = 0; i < 30; i++) {
          await this._sleep(1000);
          const c = await page.content();
          if (!c.includes('Verify you are human') && !c.includes('cf-turnstile') && !c.includes('Just a moment')) break;
        }
        await this._sleep(2000);
      }

      // Extract the status
      const result = await this._extractStatus(page);

      if (result.status) {
        const ssPath = await this._screenshot(page, `success_${receiptNumber}`);
        this.log(`✓ Got status for ${receiptNumber}: "${result.status}"`);
        return {
          success: true,
          status: result.status,
          detail: result.detail,
          checkedAt: new Date().toISOString(),
          screenshotPath: ssPath,
        };
      } else {
        const ssPath = await this._screenshot(page, `failed_${receiptNumber}`);
        // Try to get any error message from the page
        const errorText = await this._getPageErrors(page);
        return {
          success: false,
          error: errorText || 'Could not extract case status from the page.',
          checkedAt: new Date().toISOString(),
          screenshotPath: ssPath,
        };
      }
    } catch (err) {
      let ssPath = null;
      try {
        if (page) ssPath = await this._screenshot(page, `error_${receiptNumber}`);
      } catch {}

      return {
        success: false,
        error: err.message,
        checkedAt: new Date().toISOString(),
        screenshotPath: ssPath,
      };
    } finally {
      try {
        if (page) await page.close();
      } catch {}
      // Don't close the browser - we want to keep the Chrome session alive
      // so Cloudflare remembers us
      try {
        if (browser) browser.disconnect();
      } catch {}
    }
  }

  /**
   * Try multiple selectors to find the receipt number input
   */
  async _findInput(page) {
    const selectors = [
      '#receipt_number',
      '#appReceiptNum',
      'input[name="appReceiptNum"]',
      'input[name="receiptNumber"]',
      'input[id*="receipt"]',
      'input[id*="Receipt"]',
      'input[placeholder*="receipt"]',
      'input[placeholder*="Receipt"]',
      'input[aria-label*="receipt"]',
      'input[aria-label*="Receipt"]',
      'input[type="text"]',
    ];

    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            this.log(`Found input via: ${sel}`);
            return sel;
          }
        }
      } catch {}
    }

    return null;
  }

  /**
   * Try multiple selectors to find the submit button
   */
  async _findSubmitButton(page) {
    const selectors = [
      'input[type="submit"]',
      'button[type="submit"]',
      'input[value*="CHECK"]',
      'input[value*="Check"]',
      'button:has-text("Check Status")',
      'button:has-text("CHECK STATUS")',
      'input[name="check"]',
      'button[name="check"]',
      '#check-status-btn',
      '.check-status-btn',
      'a:has-text("CHECK STATUS")',
    ];

    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const visible = await el.isVisible();
          if (visible) {
            this.log(`Found submit via: ${sel}`);
            return sel;
          }
        }
      } catch {}
    }

    return null;
  }

  /**
   * Extract the case status from the results page
   */
  async _extractStatus(page) {
    // Try multiple strategies to extract the status

    // Strategy 1: Known result selectors
    const statusSelectors = [
      { status: '.current-status-sec h1', detail: '.current-status-sec p' },
      { status: '.appointment-sec h1', detail: '.appointment-sec p' },
      { status: '.rows h1', detail: '.rows p' },
      { status: '.case-status h1', detail: '.case-status p' },
      { status: 'h1.case-status', detail: 'p.case-detail' },
      { status: '[class*="status"] h1', detail: '[class*="status"] p' },
    ];

    for (const { status: sSel, detail: dSel } of statusSelectors) {
      try {
        const statusEl = await page.$(sSel);
        if (statusEl) {
          const status = (await statusEl.textContent()).trim();
          if (status && status.length > 3 && status.length < 200) {
            let detail = '';
            try {
              const detailEl = await page.$(dSel);
              if (detailEl) detail = (await detailEl.textContent()).trim();
            } catch {}
            return { status, detail };
          }
        }
      } catch {}
    }

    // Strategy 2: Find any h1 on the page that looks like a status
    try {
      const h1Elements = await page.$$('h1');
      for (const h1 of h1Elements) {
        const text = (await h1.textContent()).trim();
        if (text && text.length > 5 && text.length < 200 && this._looksLikeStatus(text)) {
          // Get the nearest paragraph
          const parent = await h1.evaluateHandle(el => el.parentElement);
          let detail = '';
          try {
            const pEl = await parent.$('p');
            if (pEl) detail = (await pEl.textContent()).trim();
          } catch {}
          return { status: text, detail };
        }
      }
    } catch {}

    // Strategy 3: Full text parsing
    try {
      const bodyText = await page.textContent('body');
      const statusPatterns = [
        /Case Was (Received|Approved|Denied|Rejected|Updated|Transferred)/i,
        /Card Was (Mailed|Delivered|Picked Up|Produced|Returned)/i,
        /Request for (Additional Evidence|Initial Evidence)/i,
        /Interview Was Scheduled/i,
        /Case Is Ready To Be Scheduled/i,
        /Fingerprint Fee Was Received/i,
        /New Card Is Being Produced/i,
        /Case Was (Sent Back|Reopened)/i,
        /Correspondence Was Received/i,
        /Name Was Updated/i,
        /Withdrawal Acknowledged/i,
      ];

      for (const pattern of statusPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          return { status: match[0], detail: '' };
        }
      }
    } catch {}

    return { status: null, detail: null };
  }

  /**
   * Check if text looks like a USCIS case status
   */
  _looksLikeStatus(text) {
    const keywords = [
      'case', 'card', 'received', 'approved', 'denied',
      'scheduled', 'produced', 'mailed', 'delivered',
      'evidence', 'fingerprint', 'interview', 'updated',
      'transferred', 'rejected', 'reopened', 'withdrawal',
    ];
    const lower = text.toLowerCase();
    return keywords.some(k => lower.includes(k));
  }

  /**
   * Try to find error messages on the page
   */
  async _getPageErrors(page) {
    try {
      const errorSelectors = [
        '.error-message',
        '.alert-danger',
        '.error',
        '[class*="error"]',
        '[role="alert"]',
      ];

      for (const sel of errorSelectors) {
        const el = await page.$(sel);
        if (el) {
          const text = (await el.textContent()).trim();
          if (text) return text;
        }
      }
    } catch {}
    return null;
  }

  /**
   * Take a screenshot for debugging
   */
  async _screenshot(page, label) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${label}_${timestamp}.png`;
      const filepath = path.join(SCREENSHOTS_DIR, filename);
      await page.screenshot({ path: filepath, fullPage: false });
      return filepath;
    } catch {
      return null;
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { USCISScraper };
