// Verifies the Edge Function's Web Push crypto against an independent receiver
// implementation (RFC 8291 aes128gcm decryption + RFC 8292 VAPID JWT verification).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, vapidAuthorization } from '../supabase/functions/reminders/webpush.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64u = (b) => Buffer.from(b).toString('base64url');

// A throwaway VAPID keypair in the same shape the Edge Function secrets use
// (raw uncompressed public point + JWK "d"), so the test needs no key file.
const vapid = await (async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { VAPID_PUBLIC_KEY: b64u(pub), VAPID_PRIVATE_KEY: jwk.d };
})();
const concat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

test('a push message encrypts so that the browser-side keys can decrypt it (RFC 8291)', async () => {
  // The "browser": a P-256 keypair and a 16-byte auth secret, as PushSubscription exposes.
  const client = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const clientPub = new Uint8Array(await crypto.subtle.exportKey('raw', client.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const body = await encrypt(JSON.stringify({ title: 'Time for Aspirin 81 mg' }), b64u(clientPub), b64u(authSecret));
  // Parse the aes128gcm header
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const serverPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);
  const serverKey = await crypto.subtle.importKey('raw', serverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, client.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), clientPub, serverPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
  assert.equal(plain[plain.length - 1], 2, 'padding delimiter');
  assert.deepEqual(JSON.parse(dec.decode(plain.slice(0, -1))), { title: 'Time for Aspirin 81 mg' });
});

test('the VAPID authorization header carries an ES256 JWT that verifies with the public key', async () => {
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey: vapid.VAPID_PUBLIC_KEY, privateKey: vapid.VAPID_PRIVATE_KEY, subject: 'mailto:test@example.com' });
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  const [, jwt, k] = m;
  assert.equal(k, vapid.VAPID_PUBLIC_KEY);
  const [h, p, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(payload.aud, 'https://fcm.googleapis.com');
  assert.equal(payload.sub, 'mailto:test@example.com');
  assert.ok(payload.exp > Date.now() / 1000 + 3600);
  const pub = Buffer.from(vapid.VAPID_PUBLIC_KEY, 'base64url');
  const key = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), enc.encode(`${h}.${p}`));
  assert.equal(ok, true);
});
