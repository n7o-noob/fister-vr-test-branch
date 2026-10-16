'use strict';
// Password-gated sealing for the test branch (served artifacts only; see DEVELOPMENT.md "Sealing").
//
// Scheme (key wrapping, like StatiCrypt): a random 256-bit master key encrypts the payload with AES-256-GCM.
// The master key is itself encrypted ("wrapped") with a key derived from the password via PBKDF2-SHA256. So the
// password unwraps the master key, and the master key decrypts the content. The master key is random per seal,
// so it is not a guessable or online-findable key; only the (weak, shipped) password gates it.
//
// NOTE: this is a deterrent on a PUBLIC repo, not real security. Anyone with the password, or willing to brute
// the password against the shipped blob, recovers everything. The source under src/ and qol/ stays readable.
//
// The envelope decrypts with browser WebCrypto (site/sealed-runtime.js) — Quest Browser, Chromium/Electron
// (Steam), any modern browser. Node's node:crypto output here is byte-compatible with SubtleCrypto AES-GCM
// (ciphertext followed by the 16-byte tag) and PBKDF2.
const crypto = require('crypto');

const ITERATIONS = 250000; // PBKDF2-SHA256 rounds; ~a fraction of a second on a Quest 2, done once per gate/run.
const b64 = (buf) => Buffer.from(buf).toString('base64');

function gcmEncrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // WebCrypto expects ciphertext||tag as one buffer.
  return { iv: b64(iv), ct: b64(Buffer.concat([body, tag])) };
}

// Seal a UTF-8 string. Returns a plain-object envelope (JSON-serialisable).
function seal(plaintext, password, opts = {}) {
  if (typeof plaintext !== 'string') throw new TypeError('seal: plaintext must be a string');
  if (!password) throw new Error('seal: a password is required');
  const iterations = opts.iterations || ITERATIONS;
  const salt = crypto.randomBytes(16);
  const masterKey = crypto.randomBytes(32); // the "real key": random 256-bit, never derived from the password
  const wrapKey = crypto.pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  return {
    v: 1,
    note: 'Sealed test build. Decrypt with the page/bookmarklet password. Deterrent only; source is public.',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: b64(salt) },
    wrap: gcmEncrypt(wrapKey, masterKey), // password-derived key wraps the master key
    data: gcmEncrypt(masterKey, Buffer.from(plaintext, 'utf8')), // master key encrypts the payload
  };
}

// Verify an envelope round-trips with the same WebCrypto code paths the browser uses (Node 18+ has global crypto).
async function openWithWebCrypto(env, password) {
  const subtle = globalThis.crypto.subtle;
  const dec = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
  const baseKey = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const wrapKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt: dec(env.kdf.salt), iterations: env.kdf.iterations, hash: env.kdf.hash },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const masterRaw = await subtle.decrypt({ name: 'AES-GCM', iv: dec(env.wrap.iv) }, wrapKey, dec(env.wrap.ct));
  const masterKey = await subtle.importKey('raw', masterRaw, { name: 'AES-GCM' }, false, ['decrypt']);
  const out = await subtle.decrypt({ name: 'AES-GCM', iv: dec(env.data.iv) }, masterKey, dec(env.data.ct));
  return new TextDecoder().decode(out);
}

module.exports = { seal, openWithWebCrypto, ITERATIONS };
