import { GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { setTimeout as delay } from 'node:timers/promises';
import { digest, fail, siteKey } from './common.mjs';
import { exportedPilotRow } from './pilot-model.mjs';
import { exportedReview } from './pilot-review-metrics.mjs';
const replayDraft = (r, v, f) =>
  r?.status === 'draft' && r.revision === v + 1 && r.lastExpectedRevision === v && r.lastFingerprint === f;
const replayConfirmation = (r, v) => r?.status === 'confirmed' && r.confirmedFromRevision === v;
export function createReviewRepository({ client, tableName }) {
  const key = (scope, week) => ({ pk: siteKey(scope), sk: `PILOT#WEEK#${week}` });
  const getReview = async (scope, week) =>
    (await client.send(new GetCommand({ TableName: tableName, Key: key(scope, week), ConsistentRead: true })))
      .Item;
  return {
    getReview,
    async saveReviewDraft({ scope, enrollment, week, period, actor, expectedRevision, data, now }) {
      const current = await getReview(scope, week);
      if (current?.status === 'confirmed') fail(409, 'pilot_review_already_confirmed');
      const fingerprint = digest({ data, period, code: enrollment.code });
      if ((current?.revision ?? 0) !== expectedRevision) {
        if (replayDraft(current, expectedRevision, fingerprint)) return current;
        fail(409, 'pilot_review_revision_conflict');
      }
      const item = {
        ...data,
        ...key(scope, week),
        code: enrollment.code,
        classification: enrollment.classification,
        week,
        period,
        status: 'draft',
        revision: expectedRevision + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        createdBy: current?.createdBy ?? actor,
        lastExpectedRevision: expectedRevision,
        lastFingerprint: fingerprint,
      };
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ...(expectedRevision === 0
              ? { ConditionExpression: 'attribute_not_exists(pk)' }
              : {
                  ConditionExpression: '#revision = :revision AND #status = :draft',
                  ExpressionAttributeNames: { '#revision': 'revision', '#status': 'status' },
                  ExpressionAttributeValues: { ':revision': expectedRevision, ':draft': 'draft' },
                }),
          }),
        );
        return item;
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') throw error;
        const winner = await getReview(scope, week);
        if (replayDraft(winner, expectedRevision, fingerprint)) return winner;
        fail(409, 'pilot_review_revision_conflict');
      }
    },
    async confirmReview({ scope, enrollment, week, expectedRevision, record, summary }) {
      const registryKey = { pk: 'PILOT#REGISTRY', sk: `COHORT#${enrollment.code}` };
      for (let attempt = 0; attempt < 6; attempt++) {
        const current = await getReview(scope, week);
        if (replayConfirmation(current, expectedRevision)) return current;
        if (!current || current.status !== 'draft' || current.revision !== expectedRevision)
          fail(409, 'pilot_review_revision_conflict');
        const row = (
          await client.send(new GetCommand({ TableName: tableName, Key: registryKey, ConsistentRead: true }))
        ).Item;
        const safe = exportedPilotRow(row);
        if (
          safe.cohort.code !== enrollment.code ||
          safe.cohort.orgId !== scope.orgId ||
          safe.cohort.siteId !== scope.siteId
        )
          throw new Error('Review registry scope mismatch');
        const existing = row.reviews === undefined ? [] : row.reviews;
        if (!Array.isArray(existing) || existing.length > 4) throw new Error('Review registry invalid');
        const reviews = existing.map((r) => exportedReview(r, safe.cohort));
        if (
          new Set(reviews.map((r) => r.week)).size !== reviews.length ||
          reviews.some((r) => r.week === week)
        )
          throw new Error('Review registry duplicate');
        const version = row.reviewVersion ?? 0;
        if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER)
          throw new Error('Review registry version invalid');
        const exported = {
          ...safe,
          ...registryKey,
          reviews: [...reviews, exportedReview(summary, safe.cohort)].sort((a, b) => a.week - b.week),
          reviewVersion: version + 1,
        };
        const names = { '#cohort': 'cohort', '#code': 'code', '#reviewVersion': 'reviewVersion' };
        const values = {
          ':code': enrollment.code,
          ...(row.reviewVersion === undefined ? {} : { ':version': version }),
        };
        try {
          await client.send(
            new TransactWriteCommand({
              TransactItems: [
                {
                  Put: {
                    TableName: tableName,
                    Item: { ...record, ...key(scope, week) },
                    ConditionExpression: '#revision = :revision AND #status = :draft',
                    ExpressionAttributeNames: { '#revision': 'revision', '#status': 'status' },
                    ExpressionAttributeValues: { ':revision': expectedRevision, ':draft': 'draft' },
                  },
                },
                {
                  Put: {
                    TableName: tableName,
                    Item: exported,
                    ConditionExpression: `#cohort.#code = :code AND ${row.reviewVersion === undefined ? 'attribute_not_exists(#reviewVersion)' : '#reviewVersion = :version'}`,
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: values,
                  },
                },
              ],
            }),
          );
          return { ...record, ...key(scope, week) };
        } catch (error) {
          if (error.name !== 'TransactionCanceledException') throw error;
          if (
            (error.CancellationReasons ?? []).some(
              (r) => r.Code && !['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(r.Code),
            )
          )
            throw error;
          const winner = await getReview(scope, week);
          if (replayConfirmation(winner, expectedRevision)) return winner;
          if (!winner || winner.status !== 'draft' || winner.revision !== expectedRevision)
            fail(409, 'pilot_review_revision_conflict');
          if (attempt === 5) fail(409, 'pilot_review_revision_conflict');
          await delay(10 * 2 ** attempt);
        }
      }
    },
  };
}
