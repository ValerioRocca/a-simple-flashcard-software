const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function randomId(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Prefixed id, e.g. `c_k3j2h1x9a0bq` for a card. */
export function newId(prefix) {
  return `${prefix}_${randomId()}`;
}
