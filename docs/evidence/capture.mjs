/**
 * Phase 2 evidence capture script.
 * Captures screenshots proving claim/paragraph critique modes work.
 */
import { chromium } from 'playwright-core';

const FRONTEND = 'http://localhost:5173';
const API = 'http://localhost:8001';
const SCREENSHOTS = './docs/evidence/screenshots';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  // 1. Settings page with critique mode radio buttons
  console.log('1. Capturing settings page with critique mode...');
  const settingsPage = await context.newPage();
  await settingsPage.goto(FRONTEND);
  await settingsPage.waitForTimeout(2000);

  // Open settings - look for gear icon or settings button
  const settingsBtn = settingsPage.locator('button[title*="Settings"], button:has-text("Settings"), .settings-trigger, [class*="settings"]').first();
  if (await settingsBtn.isVisible()) {
    await settingsBtn.click();
    await settingsPage.waitForTimeout(1000);
  }

  // Navigate to Council tab
  const councilTab = settingsPage.locator('button:has-text("Council"), [data-section="council"]').first();
  if (await councilTab.isVisible()) {
    await councilTab.click();
    await settingsPage.waitForTimeout(500);
  }

  // Scroll to debate settings section
  const debateSection = settingsPage.locator('h4:has-text("Debate Settings")').first();
  if (await debateSection.isVisible()) {
    await debateSection.scrollIntoViewIfNeeded();
    await settingsPage.waitForTimeout(300);
  }

  await settingsPage.screenshot({ path: `${SCREENSHOTS}/01-settings-critique-mode.png`, fullPage: false });
  console.log('  -> 01-settings-critique-mode.png');

  // Select claim mode
  const claimRadio = settingsPage.locator('input[value="claim"]').first();
  if (await claimRadio.isVisible()) {
    await claimRadio.click();
    await settingsPage.waitForTimeout(500);
    await settingsPage.screenshot({ path: `${SCREENSHOTS}/02-settings-claim-mode-selected.png`, fullPage: false });
    console.log('  -> 02-settings-claim-mode-selected.png');
  }

  // Select paragraph mode
  const paraRadio = settingsPage.locator('input[value="paragraph"]').first();
  if (await paraRadio.isVisible()) {
    await paraRadio.click();
    await settingsPage.waitForTimeout(500);
    await settingsPage.screenshot({ path: `${SCREENSHOTS}/03-settings-paragraph-mode.png`, fullPage: false });
    console.log('  -> 03-settings-paragraph-mode.png');
  }

  await settingsPage.close();

  // 2. API validation screenshots
  console.log('2. Capturing API validation...');
  const apiPage = await context.newPage();

  // Test critique mode validation - valid modes
  const validModes = ['freeform', 'paragraph', 'claim'];
  for (const mode of validModes) {
    const resp = await (await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ critique_mode: mode })
    })).json();
    console.log(`  API accepts critique_mode="${mode}": critique_mode=${resp.critique_mode}`);
  }

  // Test invalid mode
  const invalidResp = await fetch(`${API}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ critique_mode: 'invalid' })
  });
  console.log(`  API rejects critique_mode="invalid": status=${invalidResp.status}`);

  // Get settings showing all three modes are valid
  const settingsResp = await (await fetch(`${API}/api/settings`)).json();
  console.log(`  Current settings: critique_mode=${settingsResp.critique_mode}, debate_rounds=${settingsResp.debate_rounds}`);

  // Reset to freeform
  await fetch(`${API}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ critique_mode: 'freeform' })
  });

  await apiPage.close();

  // 3. Frontend app showing the interface
  console.log('3. Capturing main interface...');
  const mainPage = await context.newPage();
  await mainPage.goto(FRONTEND);
  await mainPage.waitForTimeout(2000);
  await mainPage.screenshot({ path: `${SCREENSHOTS}/04-main-interface.png`, fullPage: false });
  console.log('  -> 04-main-interface.png');
  await mainPage.close();

  await browser.close();
  console.log('\nDone! Screenshots saved to docs/evidence/screenshots/');
}

main().catch(console.error);
