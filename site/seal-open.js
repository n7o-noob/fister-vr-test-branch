// Self-contained decrypter (WebCrypto). Unwraps the master key with the password, then decrypts the payload.
// No dependencies beyond crypto.subtle + atob, so it runs inside a bookmarklet on fister.fun, in the Steam
// client (Electron/Chromium) and in any modern browser. Keep it standalone — the fister.fun page has none of
// FisterQoL's helpers when a bookmarklet runs.
async function fvOpen(E, pw) {
  var A = function (s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  var wk = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: A(E.kdf.salt), iterations: E.kdf.iterations, hash: E.kdf.hash }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  var mr = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: A(E.wrap.iv) }, wk, A(E.wrap.ct)); // unwrap the real key
  var mk = await crypto.subtle.importKey('raw', mr, { name: 'AES-GCM' }, false, ['decrypt']);
  var out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: A(E.data.iv) }, mk, A(E.data.ct));
  return new TextDecoder().decode(out);
}
