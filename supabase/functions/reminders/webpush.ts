// webpush.ts — Web Push without dependencies: VAPID (RFC 8292) + aes128gcm encryption (RFC 8291).
// Pure WebCrypto, so it runs in Deno (Edge Functions) and in Node (tests).

// ---------- helpers ----------
const enc = new TextEncoder();
const b64u = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
// ---------- VAPID (RFC 8292) ----------
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
const keyCache = new Map<string, CryptoKey>();
async function vapidPrivateKey(keys: VapidKeys) {
  const cached = keyCache.get(keys.privateKey);
  if (cached) return cached;
  const pub = fromB64u(keys.publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  keyCache.set(keys.privateKey, key);
  return key;
}
export async function vapidAuthorization(endpoint: string, keys: VapidKeys) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: keys.subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidPrivateKey(keys), enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${keys.publicKey}`;
}

// ---------- Message encryption (RFC 8291, aes128gcm) ----------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}
export async function encrypt(plaintext: string, p256dh: string, auth: string) {
  const clientPub = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const clientKey = await crypto.subtle.importKey("raw", clientPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), clientPub, localPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([localPub.length]), localPub, cipher);
}


export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** Send one Web Push message. Resolves to the HTTP status (201/200 on success; 404/410 mean the subscription is gone). */
export async function sendWebPush(target: PushTarget, payload: Record<string, unknown>, keys: VapidKeys, { ttl = 600 } = {}): Promise<number> {
  const body = await encrypt(JSON.stringify(payload), target.p256dh, target.auth);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: "high", Authorization: await vapidAuthorization(target.endpoint, keys) },
    body,
  });
  if (!res.ok) console.error("push failed", res.status, (await res.text()).slice(0, 200));
  return res.status;
}
