import { inspect } from 'node:util';

const REDACTED = '[redacted]';

/**
 * A sensitive string that cannot leak by accident. String interpolation,
 * JSON serialisation, and console inspection all produce "[redacted]", and
 * the value lives in a private field that nothing can enumerate. Reading it
 * requires an explicit reveal(), which makes every use visible in review.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    if (value.length === 0) {
      throw new Error('a secret cannot be empty');
    }
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return `Secret(${REDACTED})`;
  }
}
