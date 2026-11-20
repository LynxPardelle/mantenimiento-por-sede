import test from "node:test";
import assert from "node:assert/strict";
import { createLocalServer } from "../tools/serve-local.mjs";

test("local HTTP adapter supports real weekly routing with an injected test-only clock", async () => {
  let clock = new Date("2026-10-20T12:00:00Z");
  const server = await createLocalServer({ now: () => clock });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/v1/sites/north/pilot`;
    const context = await (await fetch(base)).json();
    assert.equal(context.earliestStartDate, "2026-10-21");
    const payload = {
      expectedRevision: 0,
      startDate: "2026-10-21",
      scope: {
        description: "Technical local test",
        assetScope: "all-site-assets",
        coordinators: 1,
        technicians: 1,
      },
      goals: { onTimeRateTarget: 0.8, minimumDueInspections: 5 },
      baseline: {
        weekStartDate: "2026-10-13",
        historyProtocol: "Technical protocol",
        historyAttempts: [{ success: true, seconds: 60 }],
        effortMinutes: { preparation: 20, recording: 10, assistance: 0 },
        noteUsefulnessCriterion: "Technical criterion",
      },
    };
    const write = (url, method, body) =>
      fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const saved = await (await write(base, "PUT", payload)).json();
    assert.equal(
      (
        await write(base + "/enrollment", "POST", {
          expectedRevision: saved.revision,
          agreements: {
            realOperation: true,
            authority: true,
            measurement: true,
          },
        })
      ).status,
      200,
    );
    clock = new Date("2026-11-20T01:00:00Z");
    const weeks = await (await fetch(base + "/reviews")).json();
    assert.equal(weeks.weeks.length, 4);
    assert.ok(weeks.weeks.every((w) => w.status === "closed"));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
