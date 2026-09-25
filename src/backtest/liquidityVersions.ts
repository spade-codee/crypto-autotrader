import {
  VERSION_0,
  VERSION_1_LADDER,
  type LadderStep,
  type LiquiditySweepConfig,
} from '../strategy/liquiditySweep.js';

/** A named version of the liquidity sweep: its rules and the name reports and attempt lines carry. */
export type Version = { name: string; config: LiquiditySweepConfig };

export const V0: Version = { name: 'v0', config: VERSION_0 };

/**
 * The version a research command runs, from its --version and --step flags.
 * Version 1 is not frozen yet. Until docs/research/liquidity-sweep-v1.md
 * records its ladder, only a ladder step can be named, and only counted: the
 * pre-registration counts the steps and runs the full evaluation once, for the
 * frozen version 1 alone (section 3).
 */
export function resolveVersion(version: string | undefined, step: string | undefined, countOnly: boolean): Version {
  if (version === undefined || version === '0') {
    if (step !== undefined) {
      throw new Error('--step belongs to version 1');
    }
    return V0;
  }
  if (version !== '1') {
    throw new Error('--version must be 0 or 1');
  }
  if (step === undefined) {
    throw new Error('version 1 is not frozen yet: count its ladder with --step A, B, C or D and --count-only');
  }
  if (!Object.hasOwn(VERSION_1_LADDER, step)) {
    throw new Error('--step must be A, B, C or D');
  }
  if (!countOnly) {
    throw new Error(
      'a ladder step is only counted (docs/research/liquidity-sweep-v1.md, section 3); the full run waits for the frozen version 1',
    );
  }
  return { name: `v1 step ${step}`, config: VERSION_1_LADDER[step as LadderStep] };
}
