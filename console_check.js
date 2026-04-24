const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', error => console.log(`[Browser Error] ${error.message}`));
  
  await page.goto('http://localhost:3456');
  
  // Try to login
  try {
    await page.fill('#input-password', 'YourSecurePassword123'); // Placeholder password
    await page.click('#btn-login');
  } catch (e) {
    console.log('[Test Script Error]', e.message);
  }
  
  // Wait a moment for any errors to occur
  await page.waitForTimeout(2000);
  await browser.close();
})();
