import { chromium } from "playwright";

const shotDir =
  "/private/tmp/claude-501/-Users-arpanbajpai-personal-starlink360/21e29a0b-6eb2-4fdc-a34c-e505687f2ff9/scratchpad";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://localhost:5180/", { waitUntil: "domcontentloaded" });
await page.waitForSelector('button[aria-label="Best look"]', { timeout: 60000 });
await page.waitForTimeout(3000);

await page.click('button[aria-label="Prongs"]');
await page.waitForTimeout(400);
await page.click('button[aria-label="Pick prongs on the piece"]');
await page.waitForTimeout(300);

const countText = () => page.locator(".shud-count").first().innerText().catch(() => null);

// Zoom into the pendant face (not the chain).
for (let i = 0; i < 12; i++) {
  await page.mouse.move(535, 690);
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(500);
await page.screenshot({ path: `${shotDir}/sizecap-0-zoomed.png` });

// Click dead-center of the pavé grid — a strong candidate for the giant
// connected lattice, if this piece has one like the user's screenshot.
await page.mouse.click(535, 450);
await page.waitForTimeout(300);
console.log("CLICK_CENTER_OF_GRID (expect no selection if it's the giant plate):", await countText());
await page.screenshot({ path: `${shotDir}/sizecap-1-center-click.png` });

// Scan the grid area broadly and log every distinct hit, to see what (if
// anything) IS selectable there now.
const grid = [];
for (let x = 200; x <= 900; x += 30) {
  for (let y = 150; y <= 800; y += 30) grid.push([x, y]);
}
let last = 0;
const hits = [];
for (const [x, y] of grid) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(70);
  const c = await countText();
  const n = c ? parseInt(c.match(/(\d+)/)?.[1] ?? "0", 10) : 0;
  if (n !== last) {
    hits.push({ x, y, n, delta: n - last });
    last = n;
  }
}
console.log("HITS (x,y,count-after,delta):", JSON.stringify(hits).slice(0, 2000));
await page.screenshot({ path: `${shotDir}/sizecap-2-after-scan.png` });

await browser.close();
