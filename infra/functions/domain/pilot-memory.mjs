import { digest, fail, siteKey } from './common.mjs';
import { exportedPilotRow } from './pilot-model.mjs';

// Local demonstration only. Production handlers explicitly construct the DynamoDB repository.
export function createMemoryPilotRepository() {
  const records = new Map();
  const registry = new Map();
  return {
    async get(scope) { return structuredClone(records.get(siteKey(scope))); },
    async saveDraft({ scope, actor, expectedRevision, data, now }) {
      const key = siteKey(scope);
      const current = records.get(key);
      if (current?.status === 'enrolled') fail(409, 'pilot_already_enrolled');
      const fingerprint = digest(data);
      if ((current?.revision ?? 0) !== expectedRevision) {
        if (current?.status === 'draft' && current.revision === expectedRevision + 1 && current.lastExpectedRevision === expectedRevision && current.lastFingerprint === fingerprint) return structuredClone(current);
        fail(409, 'pilot_revision_conflict');
      }
      const record = { ...structuredClone(data), status: 'draft', revision: expectedRevision + 1, createdAt: current?.createdAt ?? now, updatedAt: now, createdBy: current?.createdBy ?? actor, lastExpectedRevision: expectedRevision, lastFingerprint: fingerprint };
      records.set(key, record);
      return structuredClone(record);
    },
    async enroll({ scope, expectedRevision, record, registry: row }) {
      const key = siteKey(scope);
      const current = records.get(key);
      if (current?.status === 'enrolled' && current.confirmedFromRevision === expectedRevision) return structuredClone(current);
      if (!current || current.status !== 'draft' || current.revision !== expectedRevision) fail(409, 'pilot_revision_conflict');
      const sanitized = exportedPilotRow(row);
      if (record.code !== sanitized.cohort.code) throw new Error('Pilot registry scope mismatch');
      if (registry.has(sanitized.cohort.code)) fail(409, 'pilot_revision_conflict');
      // No await between the conditions and both writes: one local commit boundary.
      records.set(key, structuredClone(record));
      registry.set(sanitized.cohort.code, structuredClone(sanitized));
      return structuredClone(record);
    },
    async exportRegistry() {
      if (registry.size > 5000) throw new Error('Pilot registry export limit exceeded');
      const rows = [...registry.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => exportedPilotRow(row));
      const result = { schemaVersion: 1, cohorts: rows.map(row => row.cohort), baselines: rows.map(row => row.baseline) };
      if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) throw new Error('Pilot export exceeds invocation payload limit');
      return result;
    },
  };
}
