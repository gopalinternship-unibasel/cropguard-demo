/** Preserve server JSON for evidence exports; reserializing can change numbers and hashes. */
const originalJson = new WeakMap();

export async function readEvidenceJson(response) {
  const text = await response.text();
  const value = JSON.parse(text);
  if (value !== null && typeof value === 'object') originalJson.set(value, text);
  return value;
}

export function evidenceJsonBlob(value) {
  const text = originalJson.get(value);
  if (text === undefined) throw new Error('Original server JSON is unavailable. Run the analysis again before exporting.');
  return new Blob([text], {type: 'application/json'});
}
