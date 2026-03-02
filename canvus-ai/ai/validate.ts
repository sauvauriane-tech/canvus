/**
 * validate.ts — AJV op validator
 *
 * Compiles all op schemas at startup and exports a single `validateOps()`
 * function. Used by both the backend (before returning to client) and
 * optionally in-browser (before applying ops to state).
 *
 * Install: npm install ajv ajv-formats
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { opsArraySchema, opSchemas } from './schemas.js';
import type { AnyOp } from './ops.js';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Compile the full array schema
const validateOpsArray = ajv.compile(opsArraySchema);

// Compile individual op schemas for per-op error messages
const opValidators = Object.fromEntries(
  Object.entries(opSchemas).map(([k, schema]) => [k, ajv.compile(schema)])
);

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid:  boolean;
  errors: string[];
  ops:    AnyOp[];   // only the ops that passed validation
}

/**
 * Validate an array of ops from the AI response.
 * Invalid individual ops are dropped and reported; valid ones are returned.
 */
export function validateOps(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(raw)) {
    return { valid: false, errors: ['Expected an array of ops'], ops: [] };
  }

  const validOps: AnyOp[] = [];

  for (let i = 0; i < raw.length; i++) {
    const op = raw[i];
    if (typeof op !== 'object' || op === null || !('type' in op)) {
      errors.push(`Op[${i}]: missing or invalid 'type' field`);
      continue;
    }

    const opType = (op as any).type as string;
    const validator = opValidators[opType];

    if (!validator) {
      errors.push(`Op[${i}]: unknown op type '${opType}'`);
      continue;
    }

    if (!validator(op)) {
      const msgs = (validator.errors || [])
        .map(e => `  ${e.instancePath || '(root)'} ${e.message}`)
        .join('; ');
      errors.push(`Op[${i}] (${opType}): ${msgs}`);
      continue;
    }

    validOps.push(op as AnyOp);
  }

  return {
    valid:  errors.length === 0,
    errors,
    ops:    validOps,
  };
}

/**
 * Validate a single op. Throws on failure.
 */
export function assertOp(op: unknown): asserts op is AnyOp {
  const result = validateOps([op]);
  if (!result.valid || result.ops.length === 0) {
    throw new Error(`Invalid op: ${result.errors.join('; ')}`);
  }
}
