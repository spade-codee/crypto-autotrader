import type { KeyInfo } from '../account.js';
import type { Environment } from '../environment.js';

/**
 * The ONLY permissions a key may carry. This is an allowlist on purpose: a
 * blocklist of known-dangerous permissions would silently accept whatever
 * dangerous permission Bybit adds next. Anything not listed is rejected.
 */
const ALLOWED_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  Spot: ['SpotTrade'],
};

const DAY_MS = 86_400_000;
const EXPIRY_WARNING_DAYS = 14;

export type ValidationContext = {
  environment: Environment;
  /** Public IP addresses of our servers. Required to accept a mainnet key. */
  serverIps: string[];
  now: Date;
};

export type KeyValidation =
  | { ok: true; canTradeSpot: boolean; warnings: string[] }
  | { ok: false; problems: string[]; warnings: string[] };

const plural = (count: number, word: string) => (count === 1 ? word : `${word}es`);

export function validateKeyInfo(info: KeyInfo, context: ValidationContext): KeyValidation {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const [group, granted] of Object.entries(info.permissions)) {
    const allowed = ALLOWED_PERMISSIONS[group] ?? [];
    for (const permission of granted) {
      if (!allowed.includes(permission)) {
        problems.push(
          `Remove the "${group}: ${permission}" permission from this key. Only Spot trading is allowed.`,
        );
      }
    }
  }

  if (!info.unifiedTradingAccount) {
    problems.push(
      'This account is not a Unified Trading Account. Upgrade it in Bybit, then create the key again.',
    );
  }

  const unrestricted = info.ips.length === 0 || info.ips.includes('*');
  if (context.environment === 'mainnet') {
    if (context.serverIps.length === 0) {
      problems.push(
        'SERVER_IPS is not configured, so a mainnet key cannot be checked against our servers.',
      );
    } else if (unrestricted) {
      problems.push(
        `Restrict this key to our server IP ${plural(context.serverIps.length, 'address')}: ${context.serverIps.join(', ')}.`,
      );
    } else {
      const foreign = info.ips.filter((ip) => !context.serverIps.includes(ip));
      if (foreign.length > 0) {
        problems.push(
          `Remove IP ${plural(foreign.length, 'address')} ${foreign.join(', ')} from this key. It must only work from our servers.`,
        );
      }
    }
  } else if (unrestricted) {
    warnings.push(
      'This key is not restricted to an IP address. That is acceptable on testnet, but mainnet keys must be.',
    );
  }

  if (info.expiresAt !== null) {
    const daysLeft = (info.expiresAt.getTime() - context.now.getTime()) / DAY_MS;
    if (daysLeft <= 0) {
      problems.push('This key has expired. Create a new one.');
    } else if (daysLeft <= EXPIRY_WARNING_DAYS) {
      const whole = Math.ceil(daysLeft);
      warnings.push(`This key expires in ${whole} ${whole === 1 ? 'day' : 'days'}.`);
    }
  }

  // Bybit can report a read-only key that still lists trade permissions, so
  // both conditions are required.
  const canTradeSpot = !info.readOnly && (info.permissions.Spot ?? []).includes('SpotTrade');
  if (!canTradeSpot) {
    warnings.push(
      'This key cannot place spot trades. Reading balances works, but trading from Phase 2 onward needs read-write access with "Spot: SpotTrade".',
    );
  }

  return problems.length > 0
    ? { ok: false, problems, warnings }
    : { ok: true, canTradeSpot, warnings };
}
