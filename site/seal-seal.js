// Self-contained sealer (WebCrypto), the mirror of fvOpen. A random 256-bit master key encrypts the text; the
// master key is wrapped with a key derived from the password. Used in the page so the bookmarklet it copies is
// itself sealed with the password you unlocked the page with (so a copied bookmarklet won't run without it).
async function fvSeal(text, pw) {
  var E64 = function (buf) { var u = new Uint8Array(buf), s = '', CH = 0x8000; for (var i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH)); return btoa(s); };
  var salt = crypto.getRandomValues(new Uint8Array(16)), iv1 = crypto.getRandomValues(new Uint8Array(12)), iv2 = crypto.getRandomValues(new Uint8Array(12)), mr = crypto.getRandomValues(new Uint8Array(32)), it = 250000, hash = 'SHA-256';
  var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  var wk = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: it, hash: hash }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  var mk = await crypto.subtle.importKey('raw', mr, { name: 'AES-GCM' }, false, ['encrypt']);
  var wc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv1 }, wk, mr);
  var dc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv2 }, mk, new TextEncoder().encode(text));
  return { v: 1, kdf: { name: 'PBKDF2', hash: hash, iterations: it, salt: E64(salt) }, wrap: { iv: E64(iv1), ct: E64(wc) }, data: { iv: E64(iv2), ct: E64(dc) } };
}
