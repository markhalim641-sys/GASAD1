
import crypto from 'node:crypto';

export function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, 32).toString('hex');

  return `${salt}:${key}`;
}

export function verify(password, storedHash) {
  try {
    const [salt, keyHex] = storedHash.split(':');

    if (!salt || !keyHex) return false;

    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(password, salt, 32);

    return (
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}
