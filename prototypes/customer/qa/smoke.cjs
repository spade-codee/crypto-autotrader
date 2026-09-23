// Optional browser QA. No root project dependency; see README for invocation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [],
    outbound = [],
    overflows = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) outbound.push(request.url());
  });
  const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
  const visit = async (scenario, tab = "home") => {
    await page.goto(`${url}#${scenario}/${tab}`);
    await page.locator("h1").waitFor();
    await page.evaluate(() => document.fonts.ready);
  };
  const click = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  const text = () => page.locator("#content").innerText();
  let routes = 0;
  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scenario of [
        "btc",
        "usdt",
        "paused",
        "outage",
        "review",
        "operator",
        "practice",
      ]) {
        for (const tab of ["home", "strategy", "activity", "account"]) {
          await visit(scenario, tab);
          if (
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            )
          )
            overflows.push(`${scenario}/${tab}/${width}/${colorScheme}`);
          assert(
            !/undefined|NaN|%%/.test(await text()),
            `Invalid content on ${scenario}/${tab}`,
          );
          assert(await page.locator(".prototype-ribbon").isVisible());
          routes++;
        }
      }
    }
  }
  assert.deepEqual(overflows, [], "Horizontal overflow");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });

  // The trade cycle and the account have different periods and results.
  await visit("usdt");
  assert(
    (await text()).includes("980.41") && (await text()).includes("−19.59"),
  );
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page
    .getByText("Sold BTC · one completed losing cycle", { exact: false })
    .click();
  assert(
    (await text()).includes("−19.61") && (await text()).includes("46 days"),
  );

  // Pausing a USDT scenario must not invent an above-average BTC signal.
  await visit("usdt");
  await click("Pause");
  await click("Pause automation");
  assert(
    (await page.locator(".notice").innerText()).includes("below the average"),
  );
  await click("Resume");
  await click("Resume automation");
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  const titles = await page.locator(".activity-item summary").allTextContents();
  assert(
    titles[0].includes("Resumed") &&
      titles[1].includes("Paused") &&
      titles[2].includes("Decision: hold USDT"),
  );
  await page.reload();
  assert(
    !(await text()).includes("Resumed in this preview"),
    "Session state must not persist",
  );

  // A pre-existing pause has not received today's decision, so catch-up can occur.
  await visit("paused");
  await click("Resume");
  assert(
    (await page.locator("dialog").innerText()).includes(
      "within about 15 minutes",
    ),
  );
  await click("Resume automation");
  assert((await text()).includes("within about 15 minutes"));
  assert(
    !(await page.locator(".timeline").innerText()).includes("22 Sep, 01:02"),
  );
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  assert(!(await text()).includes("22 Sep, 01:02"));
  await page.getByRole("link", { name: "Account", exact: true }).click();
  assert((await text()).includes("19 Sep, 01:02"));

  // A personal pause never hides or lifts an exchange problem or operator stop.
  for (const scenario of ["outage", "operator"]) {
    await visit(scenario);
    await click("Pause");
    await click("Pause automation");
    assert(
      await page
        .getByRole("button", { name: "Resume", exact: true })
        .isVisible(),
    );
    assert(
      (await text()).includes(
        scenario === "outage"
          ? "Bybit could not be reached"
          : "Trading is stopped for everyone",
      ),
    );
    await click("Resume");
    await click("Resume automation");
    assert(
      (await text()).includes(
        scenario === "outage" ? "Decision delayed" : "Stopped for everyone",
      ),
    );
  }
  await visit("outage");
  assert(
    await page
      .getByRole("heading", { name: "Current value unavailable", exact: true })
      .isVisible(),
  );
  assert((await page.locator(".last-known").innerText()).includes("1,007.22"));
  await visit("review");
  assert((await text()).includes("990.36"));
  assert.equal(
    await page.getByRole("button", { name: /^(Pause|Resume)$/ }).count(),
    0,
  );
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  assert((await text()).includes("Order sent · sell 0.011740 BTC"));
  assert((await text()).includes("Decision: sell BTC"));

  // Historical disclaimers must have visible cost context, without duplicated %.
  await visit("btc", "strategy");
  assert(await page.locator(".evidence-costs").isVisible());
  const evidenceText = await page.locator(".evidence").innerText();
  assert(
    evidenceText.indexOf("0.1%") <
      evidenceText.indexOf("Past test, not a forecast"),
  );
  await page.getByRole("button", { name: "completed buy–sell cycles" }).click();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    assert(
      await page.evaluate(() =>
        document.querySelector("dialog").contains(document.activeElement),
      ),
      "Modal focus escaped",
    );
  }
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "completed buy–sell cycles",
  );
  await page.locator(".skip").focus();
  await page.keyboard.press("Enter");
  assert(
    page.url().endsWith("#btc/strategy"),
    "Skip link changed the scenario",
  );
  assert.equal(await page.evaluate(() => document.activeElement.id), "content");

  // Wrong answers explain, correct answers lead to practice; activation is only a preview.
  await visit("first");
  for (let i = 0; i < 4; i++)
    await page.locator('[data-action="next"]').click();
  await page.locator('input[value="1"]').check();
  await click("Check answer");
  assert(
    (await page.locator("#quiz-feedback").innerText()).includes("Try again"),
  );
  for (const answer of ["0", "1", "1"]) {
    await page.locator(`input[value="${answer}"]`).check();
    await click("Check answer");
  }
  await page.getByRole("button", { name: "Start practice" }).click();
  await page.waitForURL("**#practice/home");
  assert((await text()).includes("within about 15 minutes"));
  await page.getByRole("button", { name: "Preview going live" }).click();
  await click("Preview activation");
  assert((await page.locator("dialog").innerText()).includes("499.50"));
  assert.equal(await page.locator("dialog input").count(), 0);
  await click("Confirm in preview");
  await click("Return to practice");
  assert(page.url().endsWith("#practice/home"));

  // Keep review screenshots out of git. Use reduced motion so no transition is captured mid-frame.
  const out = path.join(__dirname, "output");
  fs.mkdirSync(out, { recursive: true });
  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await visit("btc");
      await page.screenshot({
        path: path.join(out, `home-${width}-${colorScheme}.png`),
        fullPage: true,
      });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  console.log(
    JSON.stringify({
      routes,
      errors,
      outboundRequests: outbound.length,
      overflow: overflows,
      interactionChecks: "passed",
    }),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
