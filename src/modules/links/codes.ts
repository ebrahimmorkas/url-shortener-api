import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const CODE_LENGTH = 7;

/** 62^7 ≈ 3.5 trillion codes; generated with a CSPRNG so they can't be guessed sequentially. */
export function generateCode(length = CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export const ALIAS_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/** Paths used by the API itself can never become short codes. */
export const RESERVED_ALIASES = new Set([
  'api',
  'docs',
  'health',
  'admin',
  'login',
  'register',
  'static',
  'assets',
  'favicon.ico',
  'robots.txt',
]);

export const isReservedAlias = (alias: string) => RESERVED_ALIASES.has(alias.toLowerCase());
