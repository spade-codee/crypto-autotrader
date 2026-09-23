const assert = require("node:assert/strict"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
require("node:fs").mkdirSync(path.resolve("prototypes/customer/qa/output"), {
  recursive: true,
});
(async () => {
  const b = await chromium.launch({ channel: "chrome" }),
    p = await b.newPage({ reducedMotion: "reduce" });
  const errors = [],
    outbound = [],
    issues = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    if (/^https?:/.test(r.url())) outbound.push(r.url());
  });
  const url = pathToFileURL(
    path.resolve("prototypes/customer/design-lab.html"),
  ).href;
  let screens = 0;
  for (const width of [375, 768, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    for (const route of ["home", "strategies", "activity"]) {
      await p.goto(url + "#" + route);
      await p.evaluate(() => document.fonts.ready);
      assert(
        !(await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )),
      );
      assert(!/undefined|NaN/.test(await p.locator("main").innerText()));
      await p.addScriptTag({
        path: process.env.AXE_SOURCE || require.resolve("axe-core/axe.min.js"),
      });
      const a = await p.evaluate(() =>
        axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
          },
        }),
      );
      issues.push(
        ...a.violations.map((v) => ({
          width,
          route,
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      );
      screens++;
      if (width !== 768)
        await p.screenshot({
          path: `prototypes/customer/qa/output/redesign-${route}-${width}.png`,
          fullPage: route !== "home",
        });
    }
  }
  await p.goto(url + "#strategies");
  await p.getByRole("button", { name: "See the proposed sequence" }).click();
  assert(await p.getByRole("dialog").isVisible());
  await p.addScriptTag({
    path: process.env.AXE_SOURCE || require.resolve("axe-core/axe.min.js"),
  });
  const a = await p.evaluate(() =>
    axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
      },
    }),
  );
  issues.push(
    ...a.violations.map((v) => ({
      route: "research-dialog",
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  );
  for (let i = 0; i < 5; i++) {
    await p.keyboard.press("Tab");
    assert(
      await p.evaluate(() =>
        document.querySelector("dialog").contains(document.activeElement),
      ),
    );
  }
  await p.keyboard.press("Escape");
  assert(
    (await p.evaluate(() => document.activeElement.textContent)).includes(
      "See the proposed sequence",
    ),
  );
  await p.getByRole("link", { name: "Activity", exact: false }).first().click();
  await p.locator("summary").click();
  assert((await p.locator("main").innerText()).includes("0.000012 BTC"));
  await p.locator(".skip").focus();
  await p.keyboard.press("Enter");
  assert(p.url().endsWith("#activity"));
  console.log(
    JSON.stringify({ screens: screens + 1, errors, outbound, issues }),
  );
  await b.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  assert.deepEqual(issues, []);
})();
