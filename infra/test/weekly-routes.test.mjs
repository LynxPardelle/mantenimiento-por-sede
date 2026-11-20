import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

test("weekly review routes reuse Pilot JWT integration without adding table access or a public exporter route", async () => {
  const source = await readFile(
    new URL("../services/pilot.yaml", import.meta.url),
    "utf8",
  );
  const template = parse(source.replace(/!(?:Ref|Sub|GetAtt)\s+/g, ""));
  const routes = Object.values(template.Resources).filter(
    (r) => r.Type === "AWS::ApiGatewayV2::Route",
  );
  for (const route of [
    "GET /api/v1/sites/{siteId}/pilot/reviews",
    "PUT /api/v1/sites/{siteId}/pilot/reviews/{week}",
    "POST /api/v1/sites/{siteId}/pilot/reviews/{week}/confirmation",
  ]) {
    const resource = routes.find((r) => r.Properties.RouteKey === route);
    assert.ok(resource, `missing ${route}`);
    assert.equal(resource.Properties.AuthorizationType, "JWT");
    assert.deepEqual(
      resource.Properties.AuthorizerId,
      template.Resources.ReadRoute.Properties.AuthorizerId,
    );
    assert.deepEqual(
      resource.Properties.Target,
      template.Resources.ReadRoute.Properties.Target,
    );
  }
  assert.equal(
    Object.values(template.Resources).filter(
      (r) => r.Type === "AWS::DynamoDB::Table",
    ).length,
    1,
  );
  assert.equal(
    Object.values(template.Resources).filter(
      (r) => r.Type === "AWS::ApiGatewayV2::Integration",
    ).length,
    1,
  );
});
