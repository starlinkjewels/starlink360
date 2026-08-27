import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const shots = "/Users/arpanbajpai/personal/starlink360/.phase11-shots";
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

const shot = (name) => page.screenshot({ path: `${shots}/${name}.png`, timeout: 30000 }).catch(() => {});
const railNth = (i) => page.locator(".rail button").nth(i);
const RAIL = {
  Objects: 1,
  Model: 2,
  Prongs: 8,
};
const waitLoaded = () => page.waitForSelector(".tap-hint", { timeout: 45000 });
const clickText = async (text, opts = {}) => {
  await page.locator(`button:has-text("${text}")`, opts).first().click({ timeout: 10000 });
};

const step = async (label, fn) => {
  console.log(`\n### ${label} ###`);
  try {
    await fn();
  } catch (e) {
    console.log(`  !! STEP FAILED: ${e.message.split("\n")[0]}`);
  }
};

await step("1. Load default piece", async () => {
  await page.goto("http://localhost:5001/", { waitUntil: "load", timeout: 60000 });
  await waitLoaded();
  await shot("01-loaded");
});

await step("2. Objects panel: select a metal part", async () => {
  await railNth(RAIL.Objects).click({ timeout: 10000 });
  await page.waitForSelector(".obj-kind", { timeout: 15000 });
  await shot("02-objects-panel");
  const firstMetalName = page
    .locator(".obj-kind")
    .filter({ hasText: "Metal" })
    .locator(".obj-name")
    .first();
  await firstMetalName.click({ timeout: 10000 });
  await page.waitForTimeout(300);
  console.log("  selected:", await firstMetalName.textContent());
});

await step("3. Model panel: confirm part transform is enabled", async () => {
  await railNth(RAIL.Model).click({ timeout: 10000 });
  await page.waitForTimeout(300);
  const scaleInput = page.locator('input[aria-label^="Scale, "]');
  console.log("  scale field disabled?", await scaleInput.isDisabled());
  await shot("03-model-panel-part-selected");
});

await step("4. Rotate Y 90 via preset chip", async () => {
  // Orientation section has 3 rows (X, Y, Z) of chips 0..315; Y row is the 2nd row.
  const yRow = page.locator(".panel-group", { hasText: "Orientation" }).locator(".model-row").nth(1);
  await yRow.locator('button:has-text("90°")').click({ timeout: 10000 });
  await page.waitForTimeout(500);
  await shot("04-rotated-y90");
});

await step("5. Put Horizontal, then Rotate X 45, then Reset orientation", async () => {
  await clickText("Put horizontal");
  await page.waitForTimeout(500);
  await shot("05-put-horizontal");

  const xRow = page.locator(".panel-group", { hasText: "Orientation" }).locator(".model-row").nth(0);
  await xRow.locator('button:has-text("45°")').click({ timeout: 10000 });
  await page.waitForTimeout(500);
  await shot("06-put-horizontal-plus-rotateX45");

  await clickText("Reset orientation");
  await page.waitForTimeout(500);
  await shot("07-orientation-reset");
});

await step("6. Rotate model Y90, then scale/offset the selected part, then reset", async () => {
  const yRow = page.locator(".panel-group", { hasText: "Orientation" }).locator(".model-row").nth(1);
  await yRow.locator('button:has-text("90°")').click({ timeout: 10000 });
  await page.waitForTimeout(300);
  await shot("08-rotated-before-transform");

  const scaleInput = page.locator('input[aria-label^="Scale, "]');
  const disabled = await scaleInput.isDisabled();
  console.log("  scale field disabled before transform?", disabled);
  if (!disabled) {
    await scaleInput.fill("1.6");
    await scaleInput.blur();
    await page.waitForTimeout(400);
    await shot("09-part-scaled-1.6-rotated");

    const xOffsetInput = page.locator('input[aria-label^="X offset, "]');
    await xOffsetInput.fill("0.3");
    await xOffsetInput.blur();
    await page.waitForTimeout(400);
    await shot("10-part-offset-x0.3-rotated");

    await clickText("Reset scale");
    await page.waitForTimeout(300);
    await clickText("Reset position");
    await page.waitForTimeout(400);
    await shot("11-part-transform-reset");

    await scaleInput.fill("1.6");
    await scaleInput.blur();
    await page.waitForTimeout(300);
    await clickText("Reset scale");
    await page.waitForTimeout(300);
    console.log("  scale after 2nd reset (expect 1.00):", await scaleInput.inputValue());
    await shot("12-part-transform-second-reset");
  }

  await clickText("Reset orientation");
  await page.waitForTimeout(300);
});

await step("7. Prongs: select all, view panel", async () => {
  await railNth(RAIL.Objects).click({ timeout: 10000 });
  await page.waitForTimeout(300);
  const prongsSection = page.locator(".obj-kind", { hasText: "Prongs" });
  const count = await prongsSection.count();
  console.log("  prongs sections found:", count);
  if (count > 0) {
    const countText = await prongsSection.locator(".obj-kind-count").textContent();
    console.log("  prong count:", countText);
    await prongsSection.locator("button.obj-all").click({ timeout: 10000 });
    await page.waitForTimeout(300);
    await railNth(RAIL.Prongs).click({ timeout: 10000 });
    await page.waitForTimeout(300);
    await shot("13-prongs-panel-selected");
  }
});

await browser.close();
console.log("\n### CONSOLE ERRORS ###");
for (const e of errors) console.log(" -", e.split("\n")[0]);
console.log(`total errors: ${errors.length}`);
