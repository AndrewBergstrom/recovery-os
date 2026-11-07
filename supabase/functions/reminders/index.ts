// Supabase Edge Function: push reminders for Recovery OS.
//
// Runs every 5 minutes from pg_cron (header x-cron-secret) and, with ?test=1 and a user
// JWT, sends a test notification to that user's devices. It reads the same schedule
// logic the calendar uses (imported from the published app), decides which pills just
// came due or went unlogged, and sends Web Push notifications (RFC 8291/8292) with
// WebCrypto — no npm dependencies.
//
// The app modules are imported from jsDelivr pinned to a commit (jsDelivr caches
// branch URLs for hours, so "@main" can lag a deploy and break an import). When
// js/reminders-due.js, js/schedule.js, js/seed.js or js/time.js change, bump APP_COMMIT
// and redeploy this function.
//
// Secrets: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (JWK "d", base64url), VAPID_SUBJECT.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { computeReminders, filterForSubscriber, partitionSubscribers, stateFromRecords } from "https://cdn.jsdelivr.net/gh/AndrewBergstrom/recovery-os@d4fd0aaa69a4c9af1eb1e610b2e542643e3392f8/js/reminders-due.js";
import { seedItems } from "https://cdn.jsdelivr.net/gh/AndrewBergstrom/recovery-os@d4fd0aaa69a4c9af1eb1e610b2e542643e3392f8/js/seed.js";
import { sendWebPush, type VapidKeys } from "./webpush.ts";

// deno-lint-ignore no-explicit-any
const env = (k: string): string => ((globalThis as any).Deno?.env?.get(k) ?? (globalThis as any).process?.env?.[k] ?? "") as string;
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const CRON_SECRET = env("CRON_SECRET");
const VAPID_PUBLIC = env("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = env("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = env("VAPID_SUBJECT") || "mailto:admin@example.com";
const APP_PATH = "./#today";

// ---------- helpers ----------
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const VAPID: VapidKeys = { publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE, subject: VAPID_SUBJECT };

async function rest(path: string, init: RequestInit = {}, key = SERVICE_KEY) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

type Sub = { id: string; subscriber_id: string; owner_id: string; subscriber_name: string; endpoint: string; p256dh: string; auth: string; prefs: Record<string, unknown> };

async function sendPush(sub: Sub, payload: Record<string, unknown>) {
  try {
    const status = await sendWebPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload, VAPID);
    if (status === 404 || status === 410) {
      await rest(`/rest/v1/push_subscriptions?id=eq.${sub.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return false;
    }
    return status >= 200 && status < 300;
  } catch (e) {
    console.error("push error", e);
    return false;
  }
}

// ---------- Handler ----------
export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  const cors = { "Access-Control-Allow-Origin": "*" };

  // Test mode: the signed-in user asks for a test on their own devices.
  if (url.searchParams.get("test") === "1") {
    const auth = req.headers.get("Authorization") ?? "";
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } });
    if (!userRes.ok) return new Response(JSON.stringify({ error: "not signed in" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const user = await userRes.json();
    const subs: Sub[] = await rest(`/rest/v1/push_subscriptions?subscriber_id=eq.${user.id}&select=*`);
    let sent = 0;
    for (const s of subs) if (await sendPush(s, { title: "Recovery OS", body: "Reminders are working on this device.", url: APP_PATH, tag: "test" })) sent++;
    return new Response(JSON.stringify({ sent, subscriptions: subs.length }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "forbidden" }, 403);

  const now = Date.now();
  const subs: Sub[] = await rest(`/rest/v1/push_subscriptions?select=*`);
  const byOwner = new Map<string, Sub[]>();
  for (const s of subs) byOwner.set(s.owner_id, [...(byOwner.get(s.owner_id) || []), s]);
  const report: unknown[] = [];
  for (const [ownerId, subsForOwner] of byOwner) {
    try {
      // A care partner keeps receiving reminders only while their membership is active:
      // subscriptions of revoked/removed members are dropped here (the member's device
      // cannot be trusted to unsubscribe itself).
      const members: { member_id: string }[] = await rest(`/rest/v1/care_circle?owner_id=eq.${ownerId}&revoked_at=is.null&accepted_at=not.is.null&member_id=not.is.null&select=member_id`);
      const { keep: ownerSubs, drop } = partitionSubscribers(subsForOwner, ownerId, members.map((m) => m.member_id)) as { keep: Sub[]; drop: Sub[] };
      for (const s of drop) await rest(`/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (!ownerSubs.length) continue;
      const rows = await rest(`/rest/v1/records?user_id=eq.${ownerId}&deleted=eq.false&store=in.(events,orders,meta,slot_states,milestones,appointments)&select=store,key,payload,deleted`);
      const state = stateFromRecords(rows, seedItems(new Date(now).toISOString()));
      if (!state.profile) continue;
      const tz = state.profile.timezone || "America/Los_Angeles";
      const since = new Date(now - 36 * 3600 * 1000).toISOString();
      const logRows: { slot_id: string; kind: string }[] = await rest(`/rest/v1/reminder_log?owner_id=eq.${ownerId}&sent_at=gte.${since}&select=slot_id,kind`);
      const lastSent = new Set(logRows.map((r) => `${r.slot_id}|${r.kind}`));
      const reminders = computeReminders({ state, now, lastSent });
      if (!reminders.length) continue;
      const circle: { owner_name: string }[] = await rest(`/rest/v1/care_circle?owner_id=eq.${ownerId}&select=owner_name&limit=1`);
      const ownerName = circle[0]?.owner_name || "Patient";
      for (const r of reminders) {
        let delivered = 0;
        for (const s of ownerSubs) {
          const isOwner = s.subscriber_id === ownerId;
          if (!filterForSubscriber([r], { prefs: s.prefs, isOwner, now, tz }).length) continue;
          const title = isOwner ? r.title : `${ownerName}: ${r.title}`;
          if (await sendPush(s, { title, body: r.body, url: APP_PATH, tag: r.slot_id })) delivered++;
        }
        await rest(`/rest/v1/reminder_log`, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ owner_id: ownerId, slot_id: r.slot_id, kind: r.kind }) });
        report.push({ owner: ownerId, slot: r.slot_id, kind: r.kind, delivered });
      }
    } catch (e) {
      console.error("owner failed", ownerId, e);
      report.push({ owner: ownerId, error: String(e) });
    }
  }
  return json({ ok: true, owners: byOwner.size, reminders: report });
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(handler);
