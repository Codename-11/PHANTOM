// Minimal JSON Schema (draft-07 subset) validator for the
// toolpack.phantom.dev/v1 manifest. Supports only the keywords used by
// `server/registry/manifest-schema.json` so we don't have to take on a new
// runtime dependency. Pure data — never executes manifest content.
//
// Supported keywords:
//   type, const, enum, pattern,
//   properties, additionalProperties, required,
//   items, minItems, uniqueItems,
//   minLength, minimum, maximum,
//   $ref (local #/definitions/...),
//   not / anyOf (limited to the patterns used in the schema).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(HERE, 'manifest-schema.json');

let cachedSchema = null;

function loadSchema() {
  if (!cachedSchema) {
    cachedSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  }
  return cachedSchema;
}

function joinPath(parent, key) {
  if (parent === '' || parent === undefined || parent === null) return String(key);
  return `${parent}/${key}`;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  const parts = ref.slice(2).split('/');
  let node = root;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') {
      throw new Error(`Cannot resolve $ref ${ref}: missing segment ${part}`);
    }
    node = node[part];
  }
  if (!node) throw new Error(`Cannot resolve $ref ${ref}`);
  return node;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function pushError(errors, instancePath, schemaPath, message) {
  errors.push({ instancePath, schemaPath, message });
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => deepEqual(item, b[idx]));
  }
  if (a && typeof a === 'object') {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    if (!ak.every((k, i) => k === bk[i])) return false;
    return ak.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

function validateNode(value, schema, root, instancePath, schemaPath, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.$ref) {
    const resolved = resolveRef(root, schema.$ref);
    validateNode(value, resolved, root, instancePath, schema.$ref, errors);
    return;
  }

  // type
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    // integer satisfies "number"
    const ok = allowed.some(t => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) {
      pushError(errors, instancePath, joinPath(schemaPath, 'type'),
        `expected type ${allowed.join('|')} but got ${actual}`);
      return; // further checks unsafe
    }
  }

  // const
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    if (!deepEqual(value, schema.const)) {
      pushError(errors, instancePath, joinPath(schemaPath, 'const'),
        `expected const ${JSON.stringify(schema.const)} but got ${JSON.stringify(value)}`);
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some(v => deepEqual(v, value))) {
      pushError(errors, instancePath, joinPath(schemaPath, 'enum'),
        `value ${JSON.stringify(value)} is not in enum [${schema.enum.map(v => JSON.stringify(v)).join(', ')}]`);
    }
  }

  // String constraints
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      pushError(errors, instancePath, joinPath(schemaPath, 'minLength'),
        `string shorter than minLength ${schema.minLength}`);
    }
    if (typeof schema.pattern === 'string') {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        pushError(errors, instancePath, joinPath(schemaPath, 'pattern'),
          `string does not match pattern ${schema.pattern}`);
      }
    }
  }

  // Number constraints
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      pushError(errors, instancePath, joinPath(schemaPath, 'minimum'),
        `value ${value} is less than minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      pushError(errors, instancePath, joinPath(schemaPath, 'maximum'),
        `value ${value} is greater than maximum ${schema.maximum}`);
    }
  }

  // Array constraints
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      pushError(errors, instancePath, joinPath(schemaPath, 'minItems'),
        `array shorter than minItems ${schema.minItems}`);
    }
    if (schema.uniqueItems) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) {
          if (deepEqual(value[i], value[j])) {
            pushError(errors, instancePath, joinPath(schemaPath, 'uniqueItems'),
              `array items at index ${i} and ${j} are duplicates`);
          }
        }
      }
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validateNode(value[i], schema.items, root,
          joinPath(instancePath, i), joinPath(schemaPath, 'items'), errors);
      }
    }
  }

  // Object constraints
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const requiredKey of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
          pushError(errors, instancePath, joinPath(schemaPath, 'required'),
            `missing required property "${requiredKey}"`);
        }
      }
    }
    const props = schema.properties || {};
    const additional = schema.additionalProperties;
    for (const key of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        validateNode(value[key], props[key], root,
          joinPath(instancePath, key),
          joinPath(joinPath(schemaPath, 'properties'), key), errors);
      } else if (additional === false) {
        pushError(errors, joinPath(instancePath, key),
          joinPath(schemaPath, 'additionalProperties'),
          `unknown property "${key}"`);
      } else if (additional && typeof additional === 'object') {
        validateNode(value[key], additional, root,
          joinPath(instancePath, key),
          joinPath(schemaPath, 'additionalProperties'), errors);
      }
    }
  }

  // not (used to forbid shell-string install recipes)
  if (schema.not) {
    const subErrors = [];
    validateNode(value, schema.not, root, instancePath, joinPath(schemaPath, 'not'), subErrors);
    if (subErrors.length === 0) {
      pushError(errors, instancePath, joinPath(schemaPath, 'not'),
        'value matched a forbidden "not" sub-schema');
    }
  }

  // anyOf (used inside `not` in the schema; supports general use too)
  if (Array.isArray(schema.anyOf)) {
    let matched = false;
    const branchErrors = [];
    for (let i = 0; i < schema.anyOf.length; i++) {
      const subErrors = [];
      validateNode(value, schema.anyOf[i], root, instancePath,
        joinPath(joinPath(schemaPath, 'anyOf'), i), subErrors);
      if (subErrors.length === 0) {
        matched = true;
        break;
      }
      branchErrors.push(...subErrors);
    }
    if (!matched) {
      pushError(errors, instancePath, joinPath(schemaPath, 'anyOf'),
        `value did not match any of the anyOf sub-schemas (${branchErrors.length} branch errors)`);
    }
  }
}

/**
 * Validate a parsed manifest object against the toolpack.phantom.dev/v1 schema.
 *
 * @param {object} manifest – parsed manifest JSON
 * @returns {{ ok: boolean, errors: Array<{instancePath:string, schemaPath:string, message:string}> }}
 */
export function validateManifest(manifest) {
  const errors = [];
  if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    errors.push({
      instancePath: '',
      schemaPath: '',
      message: `expected manifest to be an object but got ${typeOf(manifest)}`,
    });
    return { ok: false, errors };
  }
  const schema = loadSchema();
  validateNode(manifest, schema, schema, '', '', errors);
  return { ok: errors.length === 0, errors };
}

/** Returns the loaded schema document (useful for tests / introspection). */
export function getManifestSchema() {
  return loadSchema();
}
