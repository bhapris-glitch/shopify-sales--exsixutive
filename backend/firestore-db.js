import crypto from 'node:crypto';

const plain = value => value instanceof ObjectId ? value.toString() : value;
const normalize = value => {
  if (value instanceof ObjectId) return value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, normalize(item)]));
  return value;
};

export class ObjectId {
  constructor(value = crypto.randomBytes(12).toString('hex')) {
    if (!ObjectId.isValid(value)) throw new Error('Invalid document ID');
    this.value = String(value);
  }
  toString() { return this.value; }
  toJSON() { return this.value; }
  static isValid(value) { return /^[a-f\d]{24}$/i.test(String(value ?? '')); }
}

const pathValues = (object, path) => {
  const parts = path.split('.');
  let values = [object];
  for (const part of parts) {
    values = values.flatMap(value => {
      if (value == null) return [];
      if (Array.isArray(value) && !/^\d+$/.test(part)) return value.map(item => item?.[part]).filter(item => item !== undefined);
      const next = value[part];
      return next === undefined ? [] : [next];
    });
  }
  return values;
};
const equal = (a, b) => {
  a = plain(a); b = plain(b);
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  if (Array.isArray(a)) return a.some(item => equal(item, b));
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  return a === b;
};
const compare = (actual, condition) => {
  if (condition instanceof RegExp) return condition.test(String(actual ?? ''));
  if (condition && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition) && !(condition instanceof ObjectId)) {
    return Object.entries(condition).every(([operator, expected]) => {
      const values = Array.isArray(actual) ? actual : [actual];
      switch (operator) {
        case '$exists': return (actual !== undefined) === Boolean(expected);
        case '$ne': return !values.some(value => equal(value, expected));
        case '$in': return values.some(value => expected.some(item => equal(value, item)));
        case '$nin': return !values.some(value => expected.some(item => equal(value, item)));
        case '$gt': return values.some(value => value !== undefined && value > plain(expected));
        case '$gte': return values.some(value => value !== undefined && value >= plain(expected));
        case '$lt': return values.some(value => value !== undefined && value < plain(expected));
        case '$lte': return values.some(value => value !== undefined && value <= plain(expected));
        case '$regex': { const regex = new RegExp(expected, condition.$options || ''); return values.some(value => regex.test(String(value ?? ''))); }
        case '$options': return true;
        default: return false;
      }
    });
  }
  return equal(actual, condition);
};
const matches = (document, filter = {}) => Object.entries(filter).every(([key, condition]) => {
  if (key === '$or') return condition.some(item => matches(document, item));
  if (key === '$and') return condition.every(item => matches(document, item));
  if (key === '$nor') return !condition.some(item => matches(document, item));
  return compare(pathValues(document, key)[0], condition);
});
const setPath = (target, path, value) => {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ||= {};
  node[parts.at(-1)] = normalize(value);
};
const unsetPath = (target, path) => {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) { node = node?.[part]; if (!node) return; }
  delete node[parts.at(-1)];
};
const applyUpdate = (document, update, inserting = false) => {
  const result = { ...document };
  const operatorUpdate = Object.keys(update).some(key => key.startsWith('$'));
  if (!operatorUpdate) return { ...result, ...normalize(update) };
  if (inserting && update.$setOnInsert) for (const [key, value] of Object.entries(update.$setOnInsert)) setPath(result, key, value);
  for (const [key, value] of Object.entries(update.$set || {})) setPath(result, key, value);
  for (const [key, value] of Object.entries(update.$unset || {})) unsetPath(result, key);
  for (const [key, value] of Object.entries(update.$inc || {})) setPath(result, key, (Number(pathValues(result, key)[0]) || 0) + Number(value));
  for (const [key, value] of Object.entries(update.$push || {})) {
    const current = pathValues(result, key)[0];
    const additions = value && typeof value === 'object' && '$each' in value ? value.$each : [value];
    let next = [...(Array.isArray(current) ? current : []), ...normalize(additions)];
    if (value?.$slice != null) next = value.$slice < 0 ? next.slice(value.$slice) : next.slice(0, value.$slice);
    setPath(result, key, next);
  }
  for (const [key, value] of Object.entries(update.$addToSet || {})) {
    const current = pathValues(result, key)[0];
    const additions = value && typeof value === 'object' && '$each' in value ? value.$each : [value];
    const next = [...(Array.isArray(current) ? current : [])];
    for (const item of additions) if (!next.some(existing => equal(existing, item))) next.push(normalize(item));
    setPath(result, key, next);
  }
  return result;
};
const project = (document, projection) => {
  if (!projection) return document;
  const included = Object.entries(projection).filter(([, value]) => value === 1).map(([key]) => key);
  if (!included.length) {
    const result = { ...document };
    for (const [key, value] of Object.entries(projection)) if (value === 0) unsetPath(result, key);
    return result;
  }
  const result = {};
  for (const key of included) {
    const values = pathValues(document, key);
    if (values.length) setPath(result, key, values[0]);
  }
  if (projection._id !== 0 && document._id !== undefined) result._id = document._id;
  return result;
};
const nativeCandidate = async (collection, filter) => {
  const clauses = filter.$or ? filter.$or.map(clause => ({ ...clause, ...Object.fromEntries(Object.entries(filter).filter(([key]) => key !== '$or')) })) : [filter];
  const found = new Map();
  for (const clause of clauses) {
    if (clause._id && !(typeof clause._id === 'object' && ! (clause._id instanceof ObjectId))) {
      const id = String(plain(clause._id));
      const snap = await collection.doc(id).get();
      if (snap.exists) found.set(snap.id, { ...snap.data(), _id: new ObjectId(snap.id) });
      continue;
    }
    const candidates = Object.entries(clause).filter(([key, value]) => !key.startsWith('$') && !key.includes('.') && (value === null || ['string', 'number', 'boolean'].includes(typeof value) || value instanceof ObjectId || (value && typeof value === 'object' && Array.isArray(value.$in) && value.$in.length <= 30)));
    candidates.sort(([a], [b]) => (a === 'shop' || a === 'merchantId' || a === 'session' ? -1 : 0) - (b === 'shop' || b === 'merchantId' || b === 'session' ? -1 : 0));
    let query = collection;
    if (candidates.length) {
      const [field, condition] = candidates[0];
      if (condition && typeof condition === 'object' && '$in' in condition) query = query.where(field, 'in', condition.$in.map(plain));
      else query = query.where(field, '==', plain(condition));
    }
    const snapshot = await query.get();
    for (const doc of snapshot.docs) found.set(doc.id, { ...doc.data(), _id: new ObjectId(doc.id) });
  }
  return [...found.values()].filter(document => matches(document, filter));
};

class Cursor {
  constructor(collection, filter, options = {}) { this.collection = collection; this.filter = filter; this.projection = options.projection; this.sortSpec = null; this.max = Infinity; }
  sort(spec) { this.sortSpec = spec; return this; }
  limit(value) { this.max = value; return this; }
  async toArray() {
    let docs = await nativeCandidate(this.collection.ref, this.filter);
    if (this.sortSpec) docs.sort((a, b) => {
      for (const [field, direction] of Object.entries(this.sortSpec)) {
        const av = pathValues(a, field)[0], bv = pathValues(b, field)[0];
        const result = av == null ? (bv == null ? 0 : -1) : bv == null ? 1 : av instanceof Date || bv instanceof Date ? new Date(av) - new Date(bv) : av < bv ? -1 : av > bv ? 1 : 0;
        if (result) return result * direction;
      }
      return 0;
    });
    return docs.slice(0, this.max).map(doc => project(doc, this.projection));
  }
}

class Collection {
  constructor(ref) { this.ref = ref; }
  find(filter = {}, options = {}) { return new Cursor(this, filter, options); }
  async findOne(filter = {}, options = {}) { const docs = await nativeCandidate(this.ref, filter); return docs.length ? project(docs[0], options.projection) : null; }
  async insertOne(document) {
    const copy = normalize(document);
    const id = String(copy._id ?? crypto.randomUUID());
    delete copy._id;
    await this.ref.doc(id).set(copy);
    return { acknowledged: true, insertedId: new ObjectId(id) };
  }
  async updateOne(filter, update, options = {}) {
    const docs = await nativeCandidate(this.ref, filter);
    if (docs.length) {
      const doc = docs[0], next = applyUpdate(doc, update);
      delete next._id;
      await this.ref.doc(doc._id.toString()).set(normalize(next));
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    const seed = {};
    for (const [key, value] of Object.entries(filter)) if (!key.startsWith('$') && !(value && typeof value === 'object' && Object.keys(value).some(part => part.startsWith('$')))) setPath(seed, key, value);
    const created = applyUpdate(seed, update, true);
    const id = String(created._id ?? crypto.randomUUID());
    delete created._id;
    await this.ref.doc(id).set(normalize(created));
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: new ObjectId(id) };
  }
  async findOneAndUpdate(filter, update, options = {}) {
    const before = await this.findOne(filter);
    await this.updateOne(filter, update, options);
    const value = options.returnDocument === 'after' ? await this.findOne(filter) : before;
    return { value };
  }
  async updateMany(filter, update) {
    const docs = await nativeCandidate(this.ref, filter);
    for (let i = 0; i < docs.length; i += 450) {
      const batch = this.ref.firestore.batch();
      for (const doc of docs.slice(i, i + 450)) {
        const next = applyUpdate(doc, update); delete next._id;
        batch.set(this.ref.doc(doc._id.toString()), normalize(next));
      }
      await batch.commit();
    }
    return { acknowledged: true, matchedCount: docs.length, modifiedCount: docs.length };
  }
  async deleteOne(filter) {
    const docs = await nativeCandidate(this.ref, filter);
    if (docs.length) await this.ref.doc(docs[0]._id.toString()).delete();
    return { acknowledged: true, deletedCount: Math.min(1, docs.length) };
  }
  async deleteMany(filter) {
    const docs = await nativeCandidate(this.ref, filter);
    for (let i = 0; i < docs.length; i += 450) {
      const batch = this.ref.firestore.batch();
      for (const doc of docs.slice(i, i + 450)) batch.delete(this.ref.doc(doc._id.toString()));
      await batch.commit();
    }
    return { acknowledged: true, deletedCount: docs.length };
  }
  async countDocuments(filter = {}) { return (await nativeCandidate(this.ref, filter)).length; }
  async aggregate(pipeline = []) {
    let docs = await nativeCandidate(this.ref, pipeline.find(stage => stage.$match)?.$match || {});
    for (const stage of pipeline) {
      if (stage.$match) docs = docs.filter(doc => matches(doc, stage.$match));
      if (stage.$group) {
        const groups = new Map();
        for (const doc of docs) {
          const idExpr = stage.$group._id;
          const id = typeof idExpr === 'string' && idExpr.startsWith('$') ? pathValues(doc, idExpr.slice(1))[0] ?? null : idExpr;
          const key = JSON.stringify(normalize(id));
          if (!groups.has(key)) groups.set(key, { _id: id });
          const group = groups.get(key);
          for (const [field, expression] of Object.entries(stage.$group)) {
            if (field === '_id') continue;
            if (expression.$sum != null) {
              let value = expression.$sum;
              if (typeof value === 'string' && value.startsWith('$')) value = pathValues(doc, value.slice(1))[0];
              else if (value && value.$ifNull) { const candidate = pathValues(doc, value.$ifNull[0].slice(1))[0]; value = candidate ?? value.$ifNull[1]; }
              group[field] = (group[field] || 0) + Number(value || 0);
            }
          }
        }
        docs = [...groups.values()];
      }
    }
    return docs;
  }
  async createIndex() { return 'firestore-native-indexes'; }
}

class Database {
  constructor(firestore) { this.firestore = firestore; }
  collection(name) { return new Collection(this.firestore.collection(name)); }
  async listCollections() { return { toArray: async () => (await this.firestore.listCollections()).map(collection => ({ name: collection.id })) }; }
}
export const createFirestoreDatabase = firestore => new Database(firestore);
