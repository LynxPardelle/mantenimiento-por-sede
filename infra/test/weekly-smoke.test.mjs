import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { removeTechnicalPilot } from "../tools/pilot-smoke.mjs";
const module = await import("../tools/weekly-smoke.mjs").catch(() => ({}));
const org = "smoke-a-1234abcd";
const code = `pilot-${createHash("sha256")
  .update(JSON.stringify(["sedepulso-pilot-v1", org, "north"]))
  .digest("hex")
  .slice(0, 24)}`;
const args = {
  organization: org,
  tableName: "sedepulso-development-pilot-PilotTable-123",
  membershipTable: "sedepulso-development-platform-AccessTable-123",
  subject: "test-sub",
  now: new Date("2026-11-20T01:00:00Z"),
};
const fixture = (classification) => ({
  member: {
    orgId: { S: org },
    dataClass: { S: classification },
    sites: { L: [{ M: { id: { S: "north" }, role: { S: "coordinator" } } }] },
  },
  pilot: {
    status: { S: "enrolled" },
    classification: { S: classification },
    code: { S: code },
    revision: { N: "2" },
    timeZone: { S: "America/Mexico_City" },
    startDate: { S: "2027-02-17" },
    baseline: { M: { weekStartDate: { S: "2026-11-12" } } },
  },
  registry: {
    cohort: {
      M: {
        code: { S: code },
        orgId: { S: org },
        siteId: { S: "north" },
        classification: { S: classification },
        startDate: { S: "2027-02-17" },
        timeZone: { S: "America/Mexico_City" },
      },
    },
    baseline: {
      M: {
        period: {
          M: {
            startDate: { S: "2026-11-12" },
            endDateExclusive: { S: "2026-11-19" },
            timeZone: { S: "America/Mexico_City" },
          },
        },
      },
    },
  },
});

test("maturation rejects real or unrelated scope before writes and checks server-owned membership provenance", () => {
  assert.equal(typeof module.matureTechnicalPilot, "function");
  for (const override of [
    { organization: "customer" },
    { tableName: "other" },
    { membershipTable: "sedepulso-testing-platform-AccessTable-123" },
  ]) {
    assert.throws(
      () =>
        module.matureTechnicalPilot({
          ...args,
          ...override,
          aws: () => assert.fail("must reject before AWS"),
        }),
      /Invalid technical/,
    );
  }
  const data = fixture("enrolled-real");
  assert.throws(
    () =>
      module.matureTechnicalPilot({
        ...args,
        aws: (command) => {
          assert.equal(command[1], "get-item");
          return { Item: data.member };
        },
      }),
    /technical/,
  );
});

test("maturation derives a closed calendar only for a marked disposable fixture and uses two conditioned writes", () => {
  assert.equal(typeof module.matureTechnicalPilot, "function");
  const data = fixture("technical");
  let transaction;
  const result = module.matureTechnicalPilot({
    ...args,
    aws: (command) => {
      if (command[1] === "transact-write-items") {
        transaction = JSON.parse(
          command[command.indexOf("--transact-items") + 1],
        );
        return {};
      }
      assert.equal(command[1], "get-item");
      const key = JSON.parse(command[command.indexOf("--key") + 1]);
      return {
        Item:
          key.sk.S === "MEMBERSHIP"
            ? data.member
            : key.sk.S === "PILOT"
              ? data.pilot
              : key.sk.S.startsWith("COHORT#")
                ? data.registry
                : undefined,
      };
    },
  });
  assert.equal(result.startDate, "2026-10-22");
  assert.equal(transaction.length, 2);
  for (const item of transaction)
    assert.ok(item.Put.ConditionExpression.includes(":technical"));
  assert.equal(transaction[0].Put.Item.startDate.S, result.startDate);
  assert.equal(transaction[1].Put.Item.cohort.M.startDate.S, result.startDate);
  const baselineEnd =
    transaction[1].Put.Item.baseline.M.period.M.endDateExclusive.S;
  assert.ok(
    baselineEnd <= transaction[1].Put.Item.cohort.M.agreedAt.S.slice(0, 10),
    "baseline must be complete on agreement day",
  );
  assert.equal(baselineEnd, "2026-10-21");
});

test("technical cleanup covers all four private week keys and refuses a real weekly row", () => {
  const reads = new Set();
  removeTechnicalPilot({
    ...args,
    aws: (command) => {
      const key = JSON.parse(command[command.indexOf("--key") + 1]);
      reads.add(key.sk.S);
      return {};
    },
  });
  for (let week = 1; week <= 4; week++)
    assert.ok(reads.has(`PILOT#WEEK#${week}`));
  assert.throws(
    () =>
      removeTechnicalPilot({
        ...args,
        aws: (command) => {
          const key = JSON.parse(command[command.indexOf("--key") + 1]);
          assert.equal(command[1], "get-item");
          return key.sk.S === "PILOT#WEEK#1"
            ? { Item: { classification: { S: "enrolled-real" } } }
            : {};
        },
      }),
    /non-technical/,
  );
});

test("cleanup refuses an unclassified enrollment and a technical enrollment with a different canonical code", () => {
  for (const item of [
    { status: { S: "enrolled" } },
    {
      status: { S: "enrolled" },
      classification: { S: "technical" },
      code: { S: "another-code" },
    },
  ]) {
    let deleted = false;
    assert.throws(
      () =>
        removeTechnicalPilot({
          ...args,
          aws: (command) => {
            if (command[1] === "delete-item") {
              deleted = true;
              return {};
            }
            const key = JSON.parse(command[command.indexOf("--key") + 1]);
            return key.sk.S === "PILOT" && !deleted ? { Item: item } : {};
          },
        }),
      /non-technical|scope/,
    );
    assert.equal(deleted, false);
  }
});
