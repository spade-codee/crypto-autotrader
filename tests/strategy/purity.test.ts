import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../src/strategy', import.meta.url));
const ALLOWED = new Set(['../math.js', '../types.js', 'decimal.js']);

describe('src/strategy', () => {
  it('imports only math, types, decimal.js and its own files, and never reads a clock or randomness', () => {
    for (const file of readdirSync(DIR).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(DIR, file), 'utf8');
      for (const [, target] of source.matchAll(/from '([^']+)'/g)) {
        const sibling = /^\.\/[A-Za-z]+\.js$/.test(target!);
        expect(ALLOWED.has(target!) || sibling, `${file} imports ${target}`).toBe(true);
      }
      expect(source, `${file} reads a clock, randomness or the process`).not.toMatch(
        /Date\.now|new Date\(|Math\.random|process\./,
      );
    }
  });
});
