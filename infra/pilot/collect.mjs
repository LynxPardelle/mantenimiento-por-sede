const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const tableName = /^[A-Za-z0-9_.-]{3,255}$/;

// Operational read-only collector, deliberately separate from product runtime roles.
// Values of note, completedBy, name, membership and idempotency responses never leave DynamoDB.
export async function collectCohort({ aws, assetsTable, inspectionsTable, cohort, region = 'us-east-1', maxPages = 1000, maxItems = 100000 }) {
  if (typeof aws !== 'function' || !cohort || !identifier.test(cohort.code) || !identifier.test(cohort.orgId) || !identifier.test(cohort.siteId) || !tableName.test(assetsTable) || !tableName.test(inspectionsTable) || region !== 'us-east-1' || !Number.isSafeInteger(maxPages) || maxPages < 1 || !Number.isSafeInteger(maxItems) || maxItems < 1) throw new Error('invalid_collection_scope');
  let pages = 0;
  let itemCount = 0;
  let readCapacityUnits = 0;
  const site = `ORG#${cohort.orgId}#SITE#${cohort.siteId}`;

  function textAttribute(item, name, required = true) {
    const value = item[name];
    if (value === undefined && !required) return undefined;
    if (!value || Object.keys(value).length !== 1 || typeof value.S !== 'string') throw new Error();
    return value.S;
  }
  function exactAttributes(item, attributes) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((name) => !attributes.includes(name))) throw new Error();
  }
  function id(item, prefix) {
    const key = textAttribute(item, 'sk');
    if (!key.startsWith(prefix) || !identifier.test(key.slice(prefix.length))) throw new Error();
    return key.slice(prefix.length);
  }

  async function query(table, partition, prefix, attributes, presence) {
    const rows = [];
    const seenCursors = new Set();
    const seenIds = new Set();
    let cursor;
    do {
      if (++pages > maxPages) throw new Error();
      const names = { '#pk': 'pk', '#sk': 'sk' };
      const aliases = attributes.map((attribute, index) => { const alias = `#p${index}`; names[alias] = attribute; return alias; });
      const values = { ':pk': { S: partition }, ':prefix': { S: prefix } };
      if (presence) {
        names['#presence'] = presence;
        values[':string'] = { S: 'S' };
        values[':zero'] = { N: '0' };
      }
      const args = ['dynamodb', 'query', '--table-name', table, '--region', region, '--consistent-read', '--no-paginate', '--limit', '500', '--return-consumed-capacity', 'TOTAL', '--select', 'SPECIFIC_ATTRIBUTES', '--key-condition-expression', '#pk = :pk AND begins_with(#sk, :prefix)', '--projection-expression', aliases.join(', '), '--expression-attribute-names', JSON.stringify(names), '--expression-attribute-values', JSON.stringify(values), ...(presence ? ['--filter-expression', 'attribute_type(#presence, :string) AND size(#presence) > :zero'] : []), ...(cursor ? ['--exclusive-start-key', JSON.stringify(cursor)] : [])];
      const page = await aws(args);
      if (!page || !Array.isArray(page.Items) || !Number.isFinite(page.ConsumedCapacity?.CapacityUnits) || page.ConsumedCapacity.CapacityUnits < 0) throw new Error();
      readCapacityUnits += page.ConsumedCapacity.CapacityUnits;
      for (const item of page.Items) {
        if (++itemCount > maxItems) throw new Error();
        exactAttributes(item, attributes);
        const rowId = id(item, prefix);
        if (seenIds.has(rowId)) throw new Error();
        seenIds.add(rowId);
        rows.push(item);
      }
      cursor = page.LastEvaluatedKey;
      if (cursor && Object.keys(cursor).length === 0) cursor = undefined;
      if (cursor) {
        exactAttributes(cursor, ['pk', 'sk']);
        if (textAttribute(cursor, 'pk') !== partition) throw new Error();
        const key = textAttribute(cursor, 'sk');
        if (!key.startsWith(prefix) || !identifier.test(key.slice(prefix.length)) || seenCursors.has(key)) throw new Error();
        seenCursors.add(key);
      }
    } while (cursor);
    return rows;
  }

  try {
    const assetRows = await query(assetsTable, site, 'ASSET#', ['sk', 'status', 'createdAt']);
    const assets = assetRows.map((item) => {
      const createdAt = textAttribute(item, 'createdAt', false);
      return { id: id(item, 'ASSET#'), status: textAttribute(item, 'status'), ...(createdAt !== undefined ? { createdAt } : {}) };
    });
    const inspections = [];
    for (const asset of assets) {
      const partition = `${site}#ASSET#${asset.id}`;
      const inspectionRows = await query(inspectionsTable, partition, 'INSPECTION#', ['sk', 'assetId', 'dueDate', 'status', 'result', 'completedAt', 'createdAt']);
      const withNote = new Set((await query(inspectionsTable, partition, 'INSPECTION#', ['sk'], 'note')).map((item) => id(item, 'INSPECTION#')));
      const withAuthor = new Set((await query(inspectionsTable, partition, 'INSPECTION#', ['sk'], 'completedBy')).map((item) => id(item, 'INSPECTION#')));
      const knownIds = new Set(inspectionRows.map((item) => id(item, 'INSPECTION#')));
      // Separate consistent queries are not a transaction: concurrent new rows force a retry,
      // rather than silently adding unobserved evidence to the cut.
      if ([...withNote, ...withAuthor].some((value) => !knownIds.has(value))) throw new Error();
      for (const item of inspectionRows) {
        const inspectionId = id(item, 'INSPECTION#');
        if (textAttribute(item, 'assetId') !== asset.id) throw new Error();
        const optional = {};
        for (const attribute of ['result', 'completedAt', 'createdAt']) {
          const value = textAttribute(item, attribute, false);
          if (value !== undefined) optional[attribute] = value;
        }
        inspections.push({ id: inspectionId, assetId: asset.id, dueDate: textAttribute(item, 'dueDate'), status: textAttribute(item, 'status'), ...optional, hasNote: withNote.has(inspectionId), hasAuthor: withAuthor.has(inspectionId) });
      }
    }
    return { code: cohort.code, assets, inspections, readCapacityUnits };
  } catch {
    // AWS errors can contain partition keys; reports and Actions logs only receive this code.
    throw new Error('pilot_collection_failed');
  }
}
