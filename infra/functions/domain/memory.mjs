import { assetKey, completionMatches, digest, fail, siteKey } from './common.mjs';

export function createMemoryRepositories({ memberships = [] } = {}) {
  const members = new Map(memberships.map((entry) => [entry.sub, structuredClone(entry)]));
  const assets = new Map();
  const inspections = new Map();
  const operations = new Map();
  const entityKey = (scope, id) => `${siteKey(scope)}#${id}`;
  function create(store, args, itemKey) {
    const key = digest([args.scope, args.actor, args.operation, args.key]);
    const previous = operations.get(key);
    if (previous) {
      if (previous.fingerprint !== args.fingerprint) fail(409, 'idempotency_conflict');
      return structuredClone(previous.item);
    }
    const item = structuredClone(args.item);
    store.set(itemKey, item);
    operations.set(key, { fingerprint: args.fingerprint, item });
    return structuredClone(item);
  }
  function page(items, { limit, after }, keyFor) {
    const sorted = items.sort((left, right) => keyFor(left) < keyFor(right) ? -1 : keyFor(left) > keyFor(right) ? 1 : 0);
    const candidates = after ? sorted.filter((item) => keyFor(item) > after) : sorted;
    const selected = candidates.slice(0, limit);
    return { items: structuredClone(selected), ...(candidates.length > limit ? { after: keyFor(selected.at(-1)) } : {}) };
  }
  return {
    access: { getMembership: async (sub) => structuredClone(members.get(sub)) },
    assets: {
      getAsset: async (scope, id) => structuredClone(assets.get(entityKey(scope, id))),
      createAsset: async (args) => create(assets, args, entityKey(args.scope, args.item.id)),
      listAssets: async (scope, options) => page([...assets.entries()].filter(([key]) => key.startsWith(`${siteKey(scope)}#`)).map(([, item]) => item), options, (item) => `ASSET#${item.id}`),
    },
    inspections: {
      createInspection: async (args) => create(inspections, args, `${assetKey(args.scope, args.item.assetId)}#${args.item.id}`),
      listHistory: async (scope, assetId, options) => page([...inspections.entries()].filter(([key]) => key.startsWith(`${assetKey(scope, assetId)}#`)).map(([, item]) => item), options, (item) => `INSPECTION#${item.id}`),
      listPending: async (scope, dueThrough, options) => page([...inspections.entries()].filter(([key, item]) => key.startsWith(`${siteKey(scope)}#ASSET#`) && item.status === 'pending' && item.dueDate <= dueThrough).map(([, item]) => item), options, (item) => `${item.dueDate}#${item.assetId}#${item.id}`),
      completeInspection: async (scope, assetId, id, completion) => {
        const key = `${assetKey(scope, assetId)}#${id}`;
        const previous = inspections.get(key);
        if (!previous) fail(404, 'not_found');
        if (previous.status === 'completed') {
          if (!completionMatches(previous, completion)) fail(409, 'inspection_already_completed');
          return structuredClone(previous);
        }
        const completed = { ...previous, ...completion, status: 'completed' };
        inspections.set(key, completed);
        return structuredClone(completed);
      },
    },
  };
}
