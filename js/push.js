// push.js — push-notification subscriptions for reminders. The browser subscribes with
// the public VAPID key; the subscription is stored in Supabase (push_subscriptions),
// and the `reminders` Edge Function sends the notifications on a schedule.

import { VAPID_PUBLIC_KEY } from './config.js';
import { DEFAULT_PREFS } from './reminders-due.js';

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC_KEY;
}

export function isStandalone() {
  return typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
}

export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
  return `${os}${isStandalone() ? ' (home screen)' : ''}`;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Ask permission, subscribe, and store the subscription for this signed-in user. */
export async function enablePush({ client, ownerId, subscriberName, prefs }) {
  if (!pushSupported()) throw new Error('This browser cannot receive push notifications.');
  if (isIos() && !isStandalone()) throw new Error('On iPhone, add Recovery OS to the Home Screen first (Share → Add to Home Screen), open it from there, then turn reminders on.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. You can change this in the browser or system settings.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
  const json = sub.toJSON();
  const row = {
    subscriber_id: client.userId,
    owner_id: ownerId,
    subscriber_name: subscriberName || '',
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    device: deviceLabel(),
    prefs: { ...DEFAULT_PREFS, ...(prefs || {}) },
    updated_at: new Date().toISOString(),
  };
  await client.upsertRows('push_subscriptions', [row], 'endpoint');
  return row;
}

export async function updatePrefs({ client, prefs }) {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Reminders are not enabled on this device.');
  await client.patch('push_subscriptions', `endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { prefs: { ...DEFAULT_PREFS, ...prefs }, updated_at: new Date().toISOString() });
}

export async function disablePush({ client }) {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await client.remove('push_subscriptions', `endpoint=eq.${encodeURIComponent(sub.endpoint)}`);
  } catch {
    /* row may already be gone */
  }
  await sub.unsubscribe();
}

export async function loadPrefs({ client }) {
  const sub = await currentSubscription();
  if (!sub) return null;
  const rows = await client.select('push_subscriptions', `select=prefs,device,subscriber_name&endpoint=eq.${encodeURIComponent(sub.endpoint)}`);
  return rows[0] || null;
}

/** Ask the Edge Function to send a test notification to this user's subscriptions. */
export async function sendTest({ client }) {
  return client.callFunction('reminders', { query: 'test=1', body: {} });
}
