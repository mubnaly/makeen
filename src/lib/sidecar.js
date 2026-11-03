// Versioned JSON annotation sidecar (plan §7.2, §7.3; fixes gap defect D3).
//
// One sidecar per source document, kept SEPARATE from the PDF (source-safe).
// This module owns the schema, validation and (de)serialization. The storage
// layer owns atomic writes, rolling backups and flushing; see storage.js.

export const SCHEMA_VERSION = 1;
// Schema majors we know how to read. A sidecar with a major we do not support
// must be refused WITHOUT being overwritten (plan §7.3).
export const SUPPORTED_MAJORS = new Set([1]);

const VALID_TYPES = new Set(['marker', 'shape', 'text', 'pen']);

// Internal annotation -> sidecar annotation. Keeps only known fields and
// applies defaults; unknown optional fields on input are dropped here but the
// validator tolerates them on load (plan §7.3: "ignore unknown optional fields").
export function serializeAnnotation(a) {
  const out = {
    id: a.id,
    type: a.type,
    page: a.page,
    geometry: normalizeGeometry(a.geometry),
    style: a.style ? { ...a.style } : {},
    created_at: a.created_at || new Date().toISOString(),
    updated_at: a.updated_at || a.created_at || new Date().toISOString(),
    tags: Array.isArray(a.tags) ? [...a.tags] : []
  };
  if (typeof a.text === 'string') out.text = a.text;
  return out;
}

function normalizeGeometry(g) {
  if (!g || typeof g !== 'object') return { points: [] };
  const geo = { points: Array.isArray(g.points) ? g.points.map((p) => [Number(p[0]), Number(p[1])]) : [] };
  if (g.mode) geo.mode = g.mode;
  if (g.shape) geo.shape = g.shape;
  if (typeof g.w === 'number') geo.w = g.w;
  if (typeof g.h === 'number') geo.h = g.h;
  if (Array.isArray(g.segments)) geo.segments = g.segments.map((s) => s.map((p) => [Number(p[0]), Number(p[1])]));
  return geo;
}

export function buildSidecar({ documentId, sourceFilename, pageMetadata, annotations, fingerprint }) {
  if (!documentId) throw new Error('buildSidecar requires documentId');
  return {
    schema_version: SCHEMA_VERSION,
    document_id: documentId,
    source_filename: sourceFilename || '',
    ...(fingerprint ? { source_fingerprint: fingerprint } : {}),
    updated_at: new Date().toISOString(),
    page_metadata: pageMetadata || {},
    annotations: (annotations || []).map(serializeAnnotation)
  };
}

// Validate structure. Returns { ok, errors }. Never throws.
export function validateSidecar(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['sidecar is not an object'] };
  }
  if (typeof obj.schema_version !== 'number' || !Number.isFinite(obj.schema_version)) {
    errors.push('schema_version missing or not a number');
  } else if (!SUPPORTED_MAJORS.has(Math.floor(obj.schema_version))) {
    errors.push(`unsupported schema_version ${obj.schema_version}`);
  }
  if (typeof obj.document_id !== 'string' || !obj.document_id) {
    errors.push('document_id required');
  }
  if (!Array.isArray(obj.annotations)) {
    errors.push('annotations must be an array');
  } else {
    obj.annotations.forEach((a, i) => {
      if (!a || typeof a !== 'object') {
        errors.push(`annotations[${i}] not an object`);
        return;
      }
      if (typeof a.id !== 'string' || !a.id) errors.push(`annotations[${i}].id required`);
      if (typeof a.page !== 'number') errors.push(`annotations[${i}].page must be a number`);
      if (!VALID_TYPES.has(a.type)) errors.push(`annotations[${i}].type invalid: ${a.type}`);
      if (!a.geometry || typeof a.geometry !== 'object') errors.push(`annotations[${i}].geometry required`);
      else if (!Array.isArray(a.geometry.points) && !Array.isArray(a.geometry.segments)) {
        errors.push(`annotations[${i}].geometry.points required`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

// Parse text -> sidecar object. Throws on malformed JSON or unsupported/incompatible
// schema so the storage layer can preserve the original file (plan §7.3).
export function parseSidecar(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error(`sidecar is not valid JSON: ${e.message}`);
  }
  const result = validateSidecar(obj);
  if (!result.ok) {
    throw new Error(`sidecar invalid: ${result.errors.join('; ')}`);
  }
  return migrateSidecar(obj);
}

// Bring a supported sidecar up to the current schema. v1 is current, so this is
// a no-op pass-through today but the place to add future migrations.
export function migrateSidecar(obj) {
  if (obj.schema_version === SCHEMA_VERSION) return obj;
  return { ...obj, schema_version: SCHEMA_VERSION };
}

export function serializeSidecar(obj) {
  return JSON.stringify(obj, null, 2);
}

// Lightweight per-annotation index row for search/statistics (plan §8.2), derived
// from the authoritative sidecar so it can be rebuilt (plan §8.3).
export function indexRows(sidecar) {
  return (sidecar.annotations || []).map((a) => ({
    id: a.id,
    document_id: sidecar.document_id,
    page: a.page,
    type: a.type,
    text: typeof a.text === 'string' ? a.text : '',
    created_at: a.created_at
  }));
}
