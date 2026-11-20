import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergePilotEnrollments } from "../pilot/enrollments.mjs";

const codeFor = (organization) =>
  `pilot-${createHash("sha256")
    .update(JSON.stringify(["sedepulso-pilot-v1", organization, "north"]))
    .digest("hex")
    .slice(0, 24)}`;
const addDays = (date, days) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);

// Test administration only: no HTTP clock, customer scope or real classification is accepted.
export function matureTechnicalPilot({
  aws,
  tableName,
  membershipTable,
  organization,
  subject,
  now = new Date(),
}) {
  const match =
    /^sedepulso-(development|testing|production)-pilot-[A-Za-z0-9-]+$/.exec(
      tableName || "",
    );
  if (
    !match ||
    !/^smoke-a-[a-f0-9]{8}$/.test(organization || "") ||
    !new RegExp(`^sedepulso-${match[1]}-platform-[A-Za-z0-9-]+$`).test(
      membershipTable || "",
    ) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(subject || "")
  )
    throw new Error("Invalid technical pilot fixture scope");
  const read = (table, key) =>
    aws([
      "dynamodb",
      "get-item",
      "--table-name",
      table,
      "--key",
      JSON.stringify(key),
      "--consistent-read",
      "--region",
      "us-east-1",
    ]).Item;
  const member = read(membershipTable, {
    pk: { S: `USER#${subject}` },
    sk: { S: "MEMBERSHIP" },
  });
  if (
    member?.orgId?.S !== organization ||
    member.dataClass?.S !== "technical" ||
    !member.sites?.L?.some(
      (site) => site.M?.id?.S === "north" && site.M?.role?.S === "coordinator",
    )
  )
    throw new Error("Refusing fixture without technical membership");
  const code = codeFor(organization);
  const privateKey = {
    pk: { S: `ORG#${organization}#SITE#north` },
    sk: { S: "PILOT" },
  };
  const registryKey = {
    pk: { S: "PILOT#REGISTRY" },
    sk: { S: `COHORT#${code}` },
  };
  const original = read(tableName, privateKey);
  const originalRegistry = read(tableName, registryKey);
  const cohort = originalRegistry?.cohort?.M;
  if (
    original?.classification?.S !== "technical" ||
    original.status?.S !== "enrolled" ||
    original.code?.S !== code ||
    cohort?.classification?.S !== "technical" ||
    cohort.orgId?.S !== organization ||
    cohort.siteId?.S !== "north" ||
    cohort.code?.S !== code ||
    cohort.startDate?.S !== original.startDate?.S ||
    cohort.timeZone?.S !== original.timeZone?.S ||
    !original.baseline?.M ||
    !originalRegistry.baseline?.M?.period?.M ||
    (originalRegistry.reviews?.L?.length ?? 0) !== 0 ||
    Number(originalRegistry.reviewVersion?.N ?? 0) !== 0
  )
    throw new Error(
      "Refusing non-technical or previously reviewed pilot fixture",
    );
  for (let week = 1; week <= 4; week++)
    if (read(tableName, { ...privateKey, sk: { S: `PILOT#WEEK#${week}` } }))
      throw new Error("Refusing previously reviewed technical fixture");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: original.timeZone.S,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const startDate = addDays(today, -28);
  const baselineEnd = addDays(startDate, -1);
  const baselineStart = addDays(baselineEnd, -7);
  const agreedAt = addDays(startDate, -1) + "T12:00:00.000Z";
  const item = structuredClone(original);
  const registry = structuredClone(originalRegistry);
  Object.assign(item, privateKey, {
    startDate: { S: startDate },
    agreedAt: { S: agreedAt },
    createdAt: { S: agreedAt },
    updatedAt: { S: agreedAt },
  });
  item.baseline.M.weekStartDate = { S: baselineStart };
  Object.assign(registry, registryKey);
  Object.assign(registry.cohort.M, {
    startDate: { S: startDate },
    agreedAt: { S: agreedAt },
  });
  Object.assign(registry.baseline.M.period.M, {
    startDate: { S: baselineStart },
    endDateExclusive: { S: baselineEnd },
  });
  registry.baseline.M.capturedAt = { S: agreedAt };
  const transactions = [
    {
      Put: {
        TableName: tableName,
        Item: item,
        ConditionExpression:
          "#class = :technical AND #code = :code AND #revision = :revision AND #start = :start",
        ExpressionAttributeNames: {
          "#class": "classification",
          "#code": "code",
          "#revision": "revision",
          "#start": "startDate",
        },
        ExpressionAttributeValues: {
          ":technical": { S: "technical" },
          ":code": { S: code },
          ":revision": original.revision,
          ":start": original.startDate,
        },
      },
    },
    {
      Put: {
        TableName: tableName,
        Item: registry,
        ConditionExpression:
          "#c.#class = :technical AND #c.#org = :org AND #c.#site = :site AND #c.#code = :code AND #c.#start = :start AND (attribute_not_exists(#version) OR #version = :zero)",
        ExpressionAttributeNames: {
          "#c": "cohort",
          "#class": "classification",
          "#org": "orgId",
          "#site": "siteId",
          "#code": "code",
          "#start": "startDate",
          "#version": "reviewVersion",
        },
        ExpressionAttributeValues: {
          ":technical": { S: "technical" },
          ":org": { S: organization },
          ":site": { S: "north" },
          ":code": { S: code },
          ":start": original.startDate,
          ":zero": { N: "0" },
        },
      },
    },
  ];
  aws([
    "dynamodb",
    "transact-write-items",
    "--transact-items",
    JSON.stringify(transactions),
    "--region",
    "us-east-1",
  ]);
  return { startDate, baselineStart };
}

export async function verifyWeeklyReviews({
  aws,
  api,
  expect,
  coordinator,
  technician,
  other,
  organization,
  tableName,
  membershipTable,
  exporter,
}) {
  const path = "/api/v1/sites/north/pilot/reviews";
  expect(await api(path), 401, "revisiones exigen access token");
  expect(
    await api(path, { token: technician.token }),
    403,
    "revisiones exigen coordinación",
  );
  const future = expect(
    await api(path, { token: coordinator.token }),
    200,
    "cuatro ventanas semanales derivadas del servidor",
  );
  assert.equal(future.weeks.length, 4);
  assert.ok(
    future.weeks.every((w) => w.status === "future" && w.review === null),
  );
  const draft = {
    expectedRevision: 0,
    sameProtocol: null,
    historyAttempts: [],
    effortMinutes: { preparation: null, recording: null, assistance: null },
    noteAssessment: { reviewed: null, useful: null },
    summary: "",
    nextAction: "",
  };
  expect(
    await api(`${path}/1`, {
      token: coordinator.token,
      method: "PUT",
      body: draft,
    }),
    409,
    "no se registra una semana futura",
  );
  expect(
    await api(`${path}/1/confirmation`, {
      token: coordinator.token,
      method: "POST",
      body: { expectedRevision: 0, attested: true },
    }),
    409,
    "no se confirma una semana futura",
  );
  // Only this newly-created marked fixture gets a simulated mature calendar.
  matureTechnicalPilot({
    aws,
    tableName,
    membershipTable,
    organization,
    subject: coordinator.sub,
  });
  const closed = expect(
    await api(path, { token: coordinator.token }),
    200,
    "calendario técnico madurado sin reloj HTTP",
  );
  assert.ok(
    closed.weeks.every((w) => w.status === "closed" && w.review === null),
  );
  const saved = expect(
    await api(`${path}/1`, {
      token: coordinator.token,
      method: "PUT",
      body: draft,
    }),
    200,
    "borrador semanal conserva ausencias",
  );
  assert.equal(saved.effortMinutes.preparation, null);
  const filled = {
    ...draft,
    expectedRevision: saved.revision,
    sameProtocol: true,
    historyAttempts: [
      { success: true, seconds: 30 },
      { success: false, seconds: 50 },
    ],
    effortMinutes: { preparation: 10, recording: 5, assistance: 0 },
    noteAssessment: { reviewed: 4, useful: 3 },
    summary: `Hallazgo privado semanal ${organization}`,
    nextAction: `Acción privada semanal ${organization}`,
  };
  const complete = expect(
    await api(`${path}/1`, {
      token: coordinator.token,
      method: "PUT",
      body: filled,
    }),
    200,
    "revisión semanal completa persistida",
  );
  assert.deepEqual(
    expect(
      await api(`${path}/1`, {
        token: coordinator.token,
        method: "PUT",
        body: filled,
      }),
      200,
      "reintento de borrador semanal estable",
    ),
    complete,
  );
  expect(
    await api(`${path}/1`, {
      token: coordinator.token,
      method: "PUT",
      body: { ...filled, expectedRevision: 0 },
    }),
    409,
    "revisión semanal desactualizada rechazada",
  );
  expect(
    await api(`${path}/1/confirmation`, {
      token: coordinator.token,
      method: "POST",
      body: { expectedRevision: complete.revision, attested: false },
    }),
    400,
    "confirmación semanal requiere declaración explícita",
  );
  const confirm = { expectedRevision: complete.revision, attested: true };
  const confirmed = expect(
    await api(`${path}/1/confirmation`, {
      token: coordinator.token,
      method: "POST",
      body: confirm,
    }),
    200,
    "semana técnica confirmada",
  );
  assert.equal(confirmed.status, "confirmed");
  assert.deepEqual(
    expect(
      await api(`${path}/1/confirmation`, {
        token: coordinator.token,
        method: "POST",
        body: confirm,
      }),
      200,
      "reintento semanal conserva confirmación",
    ),
    confirmed,
  );
  expect(
    await api(`${path}/1`, {
      token: coordinator.token,
      method: "PUT",
      body: { ...filled, expectedRevision: confirmed.revision },
    }),
    409,
    "revisión semanal confirmada inmutable",
  );
  const unmeasured = {
    ...draft,
    summary: `Revisión cualitativa privada ${organization}`,
    nextAction: `Siguiente revisión privada ${organization}`,
  };
  const secondDraft = expect(
    await api(`${path}/2`, {
      token: coordinator.token,
      method: "PUT",
      body: unmeasured,
    }),
    200,
    "semana cualitativa conserva mediciones ausentes",
  );
  expect(
    await api(`${path}/2/confirmation`, {
      token: coordinator.token,
      method: "POST",
      body: { expectedRevision: secondDraft.revision, attested: true },
    }),
    200,
    "confirmación cualitativa no inventa mediciones",
  );
  const stored = expect(
    await api(path, { token: coordinator.token }),
    200,
    "comparación con línea base recuperada desde API",
  );
  const comparison = stored.weeks[0].comparison;
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.history.deltaSeconds, -30);
  assert.equal(comparison.history.changePercent, -50);
  assert.equal(comparison.effortMinutes.total.delta, -15);
  assert.equal(comparison.noteUsefulness.rate, 0.75);
  assert.equal(stored.weeks[1].comparison.reason, "not-attested");
  assert.equal(stored.weeks[1].comparison.history.reviewMedianSeconds, null);
  assert.equal(stored.weeks[1].comparison.effortMinutes.total.review, null);
  const unrelated = expect(
    await api(path, { token: other.token }),
    200,
    "otra organización no observa revisiones",
  );
  assert.equal(unrelated.enrollment, null);
  assert.deepEqual(unrelated.weeks, []);
  const file = join(tmpdir(), `sedepulso-weekly-export-${randomUUID()}.json`);
  try {
    const invocation = aws([
      "lambda",
      "invoke",
      "--function-name",
      exporter,
      "--region",
      "us-east-1",
      "--payload",
      JSON.stringify({ internalAction: "exportPilotRegistry" }),
      "--cli-binary-format",
      "raw-in-base64-out",
      file,
    ]);
    assert.ok(!invocation.FunctionError);
    const envelope = JSON.parse(await readFile(file, "utf8"));
    assert.equal(envelope.statusCode, 200);
    const exported = JSON.parse(envelope.body);
    const review = exported.reviews.find(
      (r) => r.code === codeFor(organization) && r.week === 1,
    );
    assert.ok(review);
    assert.equal(review.historyLookup.medianSuccessfulSeconds, 30);
    assert.equal(review.period.startDate, stored.weeks[0].period.startDate);
    for (const hidden of [
      filled.summary,
      filled.nextAction,
      unmeasured.summary,
      unmeasured.nextAction,
      coordinator.sub,
      "historyAttempts",
    ])
      assert.ok(!envelope.body.includes(hidden));
    const merged = mergePilotEnrollments({
      registry: { schemaVersion: 1, cohorts: [] },
      exported,
      checkedAt: new Date().toISOString(),
    });
    assert.equal(
      merged.reviews.filter((r) => r.code === codeFor(organization)).length,
      2,
    );
    expect(
      { status: 200, value: {} },
      200,
      "exportación semanal mínima sin textos ni actores",
    );
  } finally {
    await rm(file, { force: true });
  }
}
