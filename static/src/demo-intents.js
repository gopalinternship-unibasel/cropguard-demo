// Keys identify one confirmed action, including a retry after a lost response.
export function canonicalIntent(value) {
  if (Array.isArray(value)) return value.map(canonicalIntent);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalIntent(value[key])]));
  return value;
}
export function createIntentStore(storage, makeKey = () => crypto.randomUUID()) {
  const memory = new Map();
  const name = (runId, action, params) => `cropguard:intent:${JSON.stringify([runId, action, canonicalIntent(params)])}`;
  return {
    key(runId, action, params) {
      const id = name(runId, action, params);
      let key = memory.get(id);
      try { key ||= storage?.getItem(id); } catch { /* Privacy modes may disable browser storage. */ }
      if (!key) key = makeKey();
      memory.set(id, key);
      try { storage?.setItem(id, key); } catch { /* Keep the key in memory for retries. */ }
      return key;
    },
    complete(runId, action, params) {
      const id = name(runId, action, params);
      memory.delete(id);
      try { storage?.removeItem(id); } catch { /* No action secrets are stored. */ }
    }
  };
}
