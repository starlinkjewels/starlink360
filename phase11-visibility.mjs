import { chromium } from "playwright";
const shots = "/Users/arpanbajpai/personal/starlink360/.phase11-shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto("http://localhost:5001/", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector(".tap-hint", { timeout: 45000 });

await page.locator(".rail button").nth(1).click({ timeout: 10000 }); // Objects
await page.waitForSelector(".obj-kind", { timeout: 15000 });
await page.screenshot({ path: `${shots}/vis-01-objects-open.png` });

// Hide the Metal part via its eye icon
const metalRow = page.locator(".obj-row", { hasText: "Metal" }).first();
await metalRow.locator(".obj-eye").click({ timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/vis-02-metal-hidden.png` });

// Show it again
await metalRow.locator(".obj-eye").click({ timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/vis-03-metal-shown-again.png` });

// Enable "Link same names" and hide "Gem" (should also hide anything sharing base name)
await page.locator('input[type="checkbox"]').first().click({ timeout: 10000 }); // Link same names
await page.waitForTimeout(200);
const gemRow = page.locator(".obj-row", { hasText: "Gem" }).first();
await gemRow.locator(".obj-eye").click({ timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/vis-04-gem-hidden-linked.png` });

const contextLost = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
  return gl ? gl.isContextLost() : null;
});
console.log("context lost at end of visibility test?", contextLost);

// Reload to check state does NOT persist
await page.reload({ waitUntil: "load", timeout: 60000 });
await page.waitForSelector(".tap-hint", { timeout: 45000 });
await page.locator(".rail button").nth(1).click({ timeout: 10000 });
await page.waitForSelector(".obj-kind", { timeout: 15000 });
const metalEyeAfterReload = await page.locator(".obj-row", { hasText: "Metal" }).first().locator(".obj-eye").getAttribute("aria-label");
console.log("Metal eye button label after reload (expect 'Hide Metal' = visible):", metalEyeAfterReload);
await page.screenshot({ path: `${shots}/vis-05-after-reload.png` });

await browser.close();
