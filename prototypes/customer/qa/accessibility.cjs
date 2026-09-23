const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const axeSource =
  process.env.AXE_SOURCE || require.resolve("axe-core/axe.min.js");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    reducedMotion: "reduce",
  });
  const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
  const issues = [];
  let screens = 0;
  async function audit(label) {
    await page.evaluate(() => document.fonts.ready);
    if (!(await page.evaluate(() => !!window.axe)))
      await page.addScriptTag({ path: axeSource });
    const results = await page.evaluate(async () =>
      axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
        },
      }),
    );
    issues.push(
      ...results.violations.map((v) => ({
        label,
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    );
    screens++;
  }
  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme });
    for (const route of [
      "btc/home",
      "btc/strategy",
      "btc/activity",
      "btc/account",
      "outage/home",
      "review/home",
      "paused/home",
    ]) {
      await page.goto(url + "#" + route);
      await audit(route + "/" + colorScheme);
    }
    await page.goto(url + "#first/home");
    for (let step = 0; step < 5; step++) {
      await audit("onboarding-" + step + "/" + colorScheme);
      if (step < 4) await page.locator('[data-action="next"]').click();
    }
    for (const answer of ["0", "1", "1"]) {
      await page.locator(`input[value="${answer}"]`).check();
      await page.getByRole("button", { name: "Check answer" }).click();
    }
    await audit("onboarding-5/" + colorScheme);
    await page.goto(url + "#paused/home");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await audit("resume-sheet/" + colorScheme);
    await page.goto(url + "#practice/home");
    await page.getByRole("button", { name: "Preview going live" }).click();
    await page
      .getByRole("button", { name: "Preview activation", exact: true })
      .click();
    await audit("activation-sheet/" + colorScheme);
  }
  await browser.close();
  console.log(JSON.stringify({ screens, issues }));
  assert.deepEqual(issues, []);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
