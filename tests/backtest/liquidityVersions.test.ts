import { describe, expect, it } from 'vitest';
import { resolveVersion, V0 } from '../../src/backtest/liquidityVersions.js';
import { VERSION_1_LADDER } from '../../src/strategy/liquiditySweep.js';

describe('resolveVersion', () => {
  it('runs version 0 by default, and when asked for it', () => {
    expect(resolveVersion(undefined, undefined, false)).toBe(V0);
    expect(resolveVersion('0', undefined, false)).toBe(V0);
  });

  it('counts a version 1 ladder step, and only counts it', () => {
    expect(resolveVersion('1', 'B', true)).toEqual({ name: 'v1 step B', config: VERSION_1_LADDER.B });
    expect(() => resolveVersion('1', 'B', false)).toThrow('only counted');
  });

  it('refuses version 1 without a step while it is not frozen, and a step that is not on the ladder', () => {
    expect(() => resolveVersion('1', undefined, true)).toThrow('not frozen');
    expect(() => resolveVersion('1', 'E', true)).toThrow('A, B, C or D');
    expect(() => resolveVersion('0', 'A', true)).toThrow('version 1');
    expect(() => resolveVersion('2', undefined, true)).toThrow('0 or 1');
  });
});
