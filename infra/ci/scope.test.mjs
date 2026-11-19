import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('workflow scope skips only known documentation changes and fails open to verification', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r', '');
  const marker = "          python3 - <<'PY'\n";
  const start = workflow.indexOf(marker) + marker.length;
  const end = workflow.indexOf('          PY\n', start);
  assert.ok(start >= marker.length && end > start, 'scope script must be present');
  const code = workflow.slice(start, end).split('\n').map((line) => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const harness = String.raw`
import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

code = json.loads(sys.stdin.read())
cases = [
    ("push docs", "push", {"before":"a"*40}, ["README.md", "docs/x.md", "plan/test.md"], False, 0),
    ("docs directory", "push", {"before":"a"*40}, ["docs/diagram.mmd"], False, 0),
    ("runtime", "push", {"before":"a"*40}, ["frontend/src/main.ts"], True, 0),
    ("workflow", "push", {"before":"a"*40}, [".github/workflows/ci.yml"], True, 0),
    ("mixed", "push", {"before":"a"*40}, ["README.md", "infra/template.yaml"], True, 0),
    ("manual", "workflow_dispatch", {}, ["README.md"], True, 0),
    ("unknown event", "schedule", {}, ["README.md"], True, 0),
    ("missing base", "push", {}, ["README.md"], True, 0),
    ("new branch", "push", {"before":"0"*40}, ["README.md"], True, 0),
    ("pull request docs", "pull_request", {"pull_request":{"base":{"sha":"b"*40}}}, ["PRODUCTO.md"], False, 0),
    ("git failure", "push", {"before":"a"*40}, ["README.md"], True, 1),
    ("empty diff", "push", {"before":"a"*40}, [], True, 0),
]
for name, kind, event, paths, expected, status in cases:
    with TemporaryDirectory() as folder:
        event_path=Path(folder)/"event.json"
        output_path=Path(folder)/"output"
        event_path.write_text(json.dumps(event), encoding="utf-8")
        env={"GITHUB_EVENT_PATH":str(event_path), "GITHUB_OUTPUT":str(output_path), "GITHUB_EVENT_NAME":kind}
        result=SimpleNamespace(returncode=status, stdout=b"\0".join(path.encode() for path in paths)+b"\0")
        with patch.dict(os.environ,env), patch("subprocess.run",return_value=result):
            exec(compile(code,"workflow-scope","exec"),{})
        actual=output_path.read_text(encoding="utf-8")
        assert actual == f"runtime={str(expected).lower()}\n", (name,actual)
print(f"{len(cases)} scope cases passed")
`;
  const result = spawnSync('python', ['-c', harness], { input: JSON.stringify(code), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /12 scope cases passed/);
});
