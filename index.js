// Push-notification backend for the Quran Journal PWA.
//
// What this does:
//   - Stores each visitor's push subscription + reminder preferences in Workers KV.
//   - Every few minutes (see wrangler.toml's cron trigger), checks every stored
//     subscriber across THREE independent tracks:
//       1) the "every N hours" dhikr reminder
//       2) Islamic Reminders & Challenges (daily/weekly)
//       3) Prayer-time (Adhan) notifications — NEW
//   - Cleans up subscriptions the push service reports as gone (404/410).
//
// This file uses only the standard Web Crypto API via @pushforge/builder, which is
// specifically built to run on Cloudflare Workers (unlike the popular `web-push`
// npm package, which depends on Node-only crypto APIs Workers don't provide).

import { buildPushHTTPRequest } from "@pushforge/builder";

// ---- A varied pool of reminder messages, so people don't get the exact same
// ---- notification every time. One is picked at random on every send. ----
const REMINDER_MESSAGES = [
  { title: "🤍 Time for your dhikr", body: "A few quiet moments of remembrance can reset your whole day." },
  { title: "📖 Have you read some Qur'an today?", body: "Even a single page counts. Pick up right where you left off." },
  { title: "✨ Take a moment for your daily adhkar", body: "SubhanAllah, Alhamdulillah, Allahu Akbar — however many you can manage." },
  { title: "🤲 Don't forget your evening adhkar", body: "A perfect moment to seek Allah's protection before the night." },
  { title: "🌙 A little light for your heart", body: "Open your Quran journal for a few quiet minutes." },
  { title: "🕊️ Just a gentle reminder", body: "Your dhikr counter is waiting for you today." },
  { title: "💛 Checking in on you", body: "Have you had a moment with the Qur'an today?" },
  { title: "🌸 A moment to reflect", body: "Revisit a surah, or write a quick note in your journal." },
  { title: "📿 Your tongue, moist with dhikr", body: "The Prophet ﷺ loved hearts that stay attached to remembrance." },
  { title: "🕌 A short pause for your soul", body: "Even a few tasbeeh count. Come back to your journal." },
];

function pickRandomMessage() {
  return REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];
}

// ---- Islamic Reminders & Challenges — a completely separate notification
// ---- track from the 3-hour dhikr reminders above, with its own schedule. ----
const DAILY_CHALLENGE_MESSAGES = [
  // Adhkar / general reminders
  { title: "🤍 Have you made your morning adhkar today?", body: "A few quiet moments before the day gets loud." },
  { title: "🤍 Before you continue your day, remember Allah", body: "One pause, one dhikr, one breath." },
  { title: "🤍 Take a moment to say Alhamdulillah", body: "Name one thing you're grateful for right now." },
  { title: "🕌 Have you prayed your salah on time today?", body: "A gentle check-in, nothing more." },
  { title: "📵 Put your phone down for a moment", body: "Reconnect with Allah before you scroll any further." },
  { title: "🚶 Make dhikr while you walk, drive, or wait", body: "Turn today's in-between moments into worship." },
  // Quran challenges
  { title: "📖 Take 5 minutes to read Qur'an", body: "Even a few ayat can change the shape of your day." },
  { title: "📖 Read one ayah and reflect on its meaning", body: "Slow down. Let one verse really land." },
  { title: "📖 Read a surah you haven't opened in a while", body: "Rediscover something familiar, from a new place in life." },
  { title: "📖 Read the translation of today's passage", body: "Understanding deepens what you recite." },
  { title: "📖 Memorize one short ayah today", body: "Small and steady — one verse at a time." },
  { title: "📖 Review an ayah you've already memorized", body: "Keep what you've built. Recite it once more today." },
  { title: "📖 Read Qur'an before you open social media today", body: "Let the first scroll of your day be the Book." },
  // Dua challenges
  { title: "🤲 Pause for a moment and make istighfar", body: "Astaghfirullah — a small return, repeated often." },
  { title: "🤲 Make dua for your parents today", body: "A quiet request on their behalf, whenever you remember." },
  { title: "🤲 Make dua for someone who is struggling", body: "You may never know how much it helps them." },
  { title: "🤲 Make dua for someone without telling them", body: "A secret gift between you and Allah." },
  { title: "🤲 Write down 3 things you want to ask Allah for", body: "Naming them can make dua feel more real." },
  { title: "🤲 Make a dua of gratitude", body: "Before asking for more, thank Him for what's already here." },
  // Salawat
  { title: "🤍 Send salawat upon the Prophet ﷺ", body: "Allahumma salli ala Muhammad." },
  // Good deeds
  { title: "🌱 Do one good deed secretly today", body: "Let it be just between you and Allah." },
  { title: "🌱 Give someone a genuine compliment", body: "A small kindness can carry someone's whole day." },
  { title: "🌱 Give a small sadaqah today", body: "It doesn't have to be much to count." },
  { title: "🌱 Check on someone you love", body: "A short message can mean more than you think." },
  { title: "🌱 Forgive someone today", body: "Even quietly, even just within your own heart." },
  { title: "🌱 Help your parents with something today", body: "A small act of service, offered with love." },
  // Reflection prompts (tapping opens the app to reflect)
  { title: "🧠 What is one blessing Allah gave you today?", body: "Open your journal and write it down." },
  { title: "🧠 What are you struggling to be patient with?", body: "A moment of honest reflection, just for you." },
  { title: "🧠 What is something you need to leave in Allah's hands?", body: "Write it down, then let it go." },
  { title: "🧠 What are you most grateful for right now?", body: "Take a moment. Let the answer surprise you." },
];

const WEEKLY_CHALLENGES = [
  { title: "📖 Week 1 — Qur'an Week", body: "This week's focus: read at least 1 page of Qur'an every day." },
  { title: "🤍 Week 2 — Dhikr Week", body: "This week's focus: build the habit of morning and evening adhkar." },
  { title: "🌱 Week 3 — Gratitude Week", body: "This week's focus: write 3 blessings every day." },
  { title: "💗 Week 4 — Sadaqah Week", body: "This week's focus: one small act of charity, every day." },
  { title: "🕌 Week 5 — Salah Week", body: "This week's focus: pray each salah on time." },
  { title: "🤲 Week 6 — Dua Week", body: "This week's focus: write one sincere dua every day." },
  { title: "🌸 Week 7 — Character Week", body: "This week's focus: choose one character trait to work on." },
  { title: "📵 Week 8 — Digital Detox Week", body: "This week's focus: a little less scrolling, a little more Qur'an." },
];

function pickRandomDailyChallenge() {
  return DAILY_CHALLENGE_MESSAGES[Math.floor(Math.random() * DAILY_CHALLENGE_MESSAGES.length)];
}

// ISO week number, so the weekly theme is the same for everyone in the same
// calendar week, and advances predictably from week to week.
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function currentWeeklyChallenge() {
  const week = isoWeekNumber(new Date());
  return WEEKLY_CHALLENGES[week % WEEKLY_CHALLENGES.length];
}

// ---- Prayer-time (Adhan) notifications — NEW ----
//
// Times come from the same free Al Adhan API the client already uses for the
// in-app Prayer Times page, so the notification always matches what's shown
// on screen. We only ever notify for the five prayers people actually pray —
// Sunrise/Sunset/Imsak/Midnight are informational only, not adhan times.
const ADHAN_PRAYER_NAMES = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

const ADHAN_MESSAGES = {
  Fajr: { title: "🕌 It's time for Fajr", body: "The night's stillness — a quiet start to the day." },
  Dhuhr: { title: "🕌 It's time for Dhuhr", body: "A pause in the middle of the day, for Allah." },
  Asr: { title: "🕌 It's time for Asr", body: "The afternoon prayer — don't let it slip by." },
  Maghrib: { title: "🕌 It's time for Maghrib", body: "The sun has set. Time to pray." },
  Isha: { title: "🕌 It's time for Isha", body: "The day's last prayer — close it out with Allah." },
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "05:12", "05:12 (+03)", etc. -> minutes since local midnight. Returns null
// if the string can't be parsed (defensive — the API is generally reliable).
function timeStringToMinutes(timeStr) {
  if (typeof timeStr !== "string") return null;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// Subscriber's current local date (YYYY-MM-DD) and minutes-since-midnight, in
// their own timezone — needed because Aladhan's timings are for a specific
// local calendar date at that location, not UTC.
function localDateAndMinutes(timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const year = get("year"), month = get("month"), day = get("day");
    let hour = parseInt(get("hour"), 10);
    const minute = parseInt(get("minute"), 10);
    if (hour === 24) hour = 0;
    return { dateKey: `${year}-${month}-${day}`, minutes: hour * 60 + minute, day: parseInt(day, 10), month: parseInt(month, 10), year: parseInt(year, 10) };
  } catch (err) {
    const now = new Date();
    return {
      dateKey: now.toISOString().split("T")[0],
      minutes: now.getUTCHours() * 60 + now.getUTCMinutes(),
      day: now.getUTCDate(), month: now.getUTCMonth() + 1, year: now.getUTCFullYear(),
    };
  }
}

// Prayer times are identical for every subscriber at (roughly) the same spot
// on the same day using the same method — cache per lat/lng/method/date in KV
// so ten people in the same city don't trigger ten separate API calls on every
// cron tick. Coordinates are rounded to ~1km precision for cache-key purposes
// only (the precision loss doesn't meaningfully change prayer times).
async function getPrayerTimings(env, lat, lng, method, timezone, dateInfo) {
  const cacheKey = `pt:${lat.toFixed(2)}:${lng.toFixed(2)}:${method}:${dateInfo.dateKey}`;
  const cached = await env.SUBSCRIPTIONS.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (err) { /* fall through and refetch */ }
  }
  const dateStr = `${pad2(dateInfo.day)}-${pad2(dateInfo.month)}-${dateInfo.year}`;
  const url = `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${lat}&longitude=${lng}&method=${method}&timezonestring=${encodeURIComponent(timezone || "UTC")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Aladhan API error " + res.status);
  const data = await res.json();
  if (data.code !== 200 || !data.data || !data.data.timings) throw new Error("Unexpected Aladhan response");
  const timings = data.data.timings;
  // Cache for 2 days — comfortably covers the rest of today plus buffer for
  // clock-skew near midnight, and self-expires so KV doesn't grow forever.
  await env.SUBSCRIPTIONS.put(cacheKey, JSON.stringify(timings), { expirationTtl: 60 * 60 * 48 });
  return timings;
}

// CORS: allow your GitHub Pages site to call this Worker from the browser.
// Change "*" to your exact site origin (e.g. "https://yourname.github.io") once
// you know it, for tighter security — "*" works fine to get started.
const ALLOWED_ORIGIN = "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// Subscriptions are keyed by a short hash of their endpoint URL, so the same
// device/browser subscription always maps to the same KV key (re-subscribing
// updates the existing record instead of creating duplicates).
async function keyForSubscription(subscription) {
  const enc = new TextEncoder().encode(subscription.endpoint);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "sub:" + hex.slice(0, 40);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizePrefs(prefs) {
  prefs = prefs || {};
  const challengeMode = ["off", "daily", "weekly", "both"].includes(prefs.challengeMode) ? prefs.challengeMode : "off";
  // Prayer notifications need a real lat/lng to mean anything — treat missing
  // or out-of-range coordinates as "not configured" rather than guessing.
  const hasPrayerLocation = Number.isFinite(Number(prefs.prayerLat)) && Number.isFinite(Number(prefs.prayerLng)) &&
    Math.abs(Number(prefs.prayerLat)) <= 90 && Math.abs(Number(prefs.prayerLng)) <= 180;
  return {
    enabled: !!prefs.enabled,
    // Hour-of-day, 0-23, in the subscriber's own timezone.
    activeStartHour: clampInt(prefs.activeStartHour, 0, 23, 7),
    activeEndHour: clampInt(prefs.activeEndHour, 0, 23, 21),
    // Minimum 1 hour between reminders, to prevent accidental/abusive spam and
    // keep this comfortably inside Cloudflare's free tier.
    intervalHours: clampInt(prefs.intervalHours, 1, 12, 3),
    // IANA timezone name, e.g. "Europe/London". Falls back to UTC if missing/invalid.
    timezone: typeof prefs.timezone === "string" && prefs.timezone ? prefs.timezone : "UTC",

    // ---- Islamic Reminders & Challenges — a fully separate track ----
    // "off" | "daily" | "weekly" | "both"
    challengeMode,
    // Hour-of-day this fires at (a single specific hour, not a repeating interval).
    challengeHour: clampInt(prefs.challengeHour, 0, 23, 9),
    // Day of week the *weekly* challenge is sent, 0=Sunday .. 6=Saturday.
    challengeWeekday: clampInt(prefs.challengeWeekday, 0, 6, 1), // default Monday

    // ---- Prayer-time (Adhan) notifications — NEW, also a fully separate track ----
    prayerEnabled: !!prefs.prayerEnabled && hasPrayerLocation,
    prayerLat: hasPrayerLocation ? clampFloat(prefs.prayerLat, -90, 90, null) : null,
    prayerLng: hasPrayerLocation ? clampFloat(prefs.prayerLng, -180, 180, null) : null,
    // Same calculation-method ids as the in-app Prayer Times page (Muslim World
    // League, ISNA, Umm Al-Qura, Egyptian, Diyanet).
    prayerMethod: clampInt(prefs.prayerMethod, 0, 20, 3),
  };
}

async function handleSubscribe(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.subscription || !body.subscription.endpoint) {
    return json({ error: "Missing subscription" }, 400);
  }
  const prefs = sanitizePrefs(body.prefs);
  const key = await keyForSubscription(body.subscription);
  const existingRaw = await env.SUBSCRIPTIONS.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;

  const record = {
    subscription: body.subscription,
    prefs,
    // Preserve every "last sent" timestamp across preference updates so changing
    // your schedule doesn't immediately trigger a new push on any track.
    lastSentAt: existing ? existing.lastSentAt : null,
    lastDailyChallengeAt: existing ? existing.lastDailyChallengeAt : null,
    lastWeeklyChallengeAt: existing ? existing.lastWeeklyChallengeAt : null,
    // { Fajr: "2026-09-04", Dhuhr: "2026-09-04", ... } — which prayers have
    // already been notified today, so we never double-send one.
    lastPrayerSentDate: existing ? existing.lastPrayerSentDate || {} : {},
    updatedAt: Date.now(),
  };
  await env.SUBSCRIPTIONS.put(key, JSON.stringify(record));
  return json({ ok: true });
}

async function handleUnsubscribe(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.subscription || !body.subscription.endpoint) {
    return json({ error: "Missing subscription" }, 400);
  }
  const key = await keyForSubscription(body.subscription);
  await env.SUBSCRIPTIONS.delete(key);
  return json({ ok: true });
}

async function sendPushTo(env, subscription, message, targetUrl) {
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: JSON.parse(env.VAPID_PRIVATE_KEY),
    subscription,
    message: {
      payload: {
        title: message.title,
        body: message.body,
        icon: "icons/icon-192.png",
        badge: "icons/icon-96.png",
        url: targetUrl || "./index.html",
      },
      adminContact: env.VAPID_SUBJECT,
      options: { ttl: 3600, urgency: "normal" },
    },
  });
  return fetch(endpoint, { method: "POST", headers, body });
}

async function handleTestPush(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.subscription || !body.subscription.endpoint) {
    return json({ error: "Missing subscription" }, 400);
  }
  try {
    const res = await sendPushTo(env, body.subscription, pickRandomMessage(), "./index.html");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({ ok: false, status: res.status, detail: text }, 502);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}

function currentLocalHour(timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === "hour");
    let hour = hourPart ? parseInt(hourPart.value, 10) : new Date().getUTCHours();
    if (hour === 24) hour = 0; // some locales format midnight as "24"
    return hour;
  } catch (err) {
    // Invalid/unsupported timezone string — fall back to UTC rather than failing.
    return new Date().getUTCHours();
  }
}

function isWithinActiveHours(hour, startHour, endHour) {
  if (startHour === endHour) return true; // 24/7 if start === end
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Window wraps past midnight, e.g. 22 -> 2
  return hour >= startHour || hour < endHour;
}

async function trySend(env, key, record, message, targetUrl) {
  try {
    const res = await sendPushTo(env, record.subscription, message, targetUrl);
    if (res.status === 404 || res.status === 410) {
      // The push service confirms this subscription no longer exists
      // (uninstalled, permission revoked, etc.) — clean it up.
      await env.SUBSCRIPTIONS.delete(key);
      return "removed";
    }
    return res.ok ? "sent" : "failed";
  } catch (err) {
    // Network/encryption error for this one subscriber — skip it this round,
    // try again on the next scheduled tick rather than failing the whole batch.
    console.warn("Failed to send push for", key, err);
    return "failed";
  }
}

// How many minutes past the exact Adhan time we'll still fire a "just missed
// it" notification for — needs to comfortably cover the gap between cron
// ticks (see wrangler.toml) so no prayer gets silently skipped, without being
// so wide that a notification could show up absurdly late.
const PRAYER_CATCHUP_WINDOW_MINUTES = 20;

async function checkPrayerNotifications(env, key, record) {
  const prefs = record.prefs;
  if (!prefs.prayerEnabled || prefs.prayerLat === null || prefs.prayerLng === null) {
    return { dirty: false, removed: false, sent: 0 };
  }
  const dateInfo = localDateAndMinutes(prefs.timezone);
  let timings;
  try {
    timings = await getPrayerTimings(env, prefs.prayerLat, prefs.prayerLng, prefs.prayerMethod, prefs.timezone, dateInfo);
  } catch (err) {
    console.warn("Failed to fetch prayer timings for", key, err);
    return { dirty: false, removed: false, sent: 0 };
  }

  let dirty = false;
  let sentCount = 0;
  const lastSent = record.lastPrayerSentDate || {};

  for (const prayerName of ADHAN_PRAYER_NAMES) {
    const prayerMinutes = timeStringToMinutes(timings[prayerName]);
    if (prayerMinutes === null) continue;
    if (lastSent[prayerName] === dateInfo.dateKey) continue; // already notified today
    const minutesSincePrayer = dateInfo.minutes - prayerMinutes;
    if (minutesSincePrayer < 0 || minutesSincePrayer > PRAYER_CATCHUP_WINDOW_MINUTES) continue;

    const result = await trySend(env, key, record, ADHAN_MESSAGES[prayerName], "./index.html?open=qibla");
    if (result === "removed") {
      return { dirty: false, removed: true, sent: sentCount };
    }
    if (result === "sent") {
      lastSent[prayerName] = dateInfo.dateKey;
      dirty = true;
      sentCount++;
    }
  }

  if (dirty) record.lastPrayerSentDate = lastSent;
  return { dirty, removed: false, sent: sentCount };
}

async function runScheduledCheck(env) {
  const now = Date.now();
  const nowDate = new Date();
  let cursor;
  let processed = 0;
  let sentGeneral = 0;
  let sentChallenge = 0;
  let sentPrayer = 0;
  let removed = 0;

  do {
    const page = await env.SUBSCRIPTIONS.list({ cursor, limit: 1000 });
    cursor = page.cursor;

    for (const { name: key } of page.keys) {
      processed++;
      // Cached prayer-timing lookups use the same KV namespace with a "pt:"
      // prefix — skip them here, they aren't subscriber records.
      if (key.startsWith("pt:")) continue;
      const raw = await env.SUBSCRIPTIONS.get(key);
      if (!raw) continue;
      let record;
      try {
        record = JSON.parse(raw);
      } catch (err) {
        continue;
      }
      const prefs = record.prefs;
      if (!prefs) continue;

      const hour = currentLocalHour(prefs.timezone);
      let dirty = false;
      let removedThisRecord = false;

      // ---- Track 1: the general "every N hours" dhikr reminder ----
      if (prefs.enabled && isWithinActiveHours(hour, prefs.activeStartHour, prefs.activeEndHour)) {
        const intervalMs = prefs.intervalHours * 60 * 60 * 1000;
        if (!record.lastSentAt || now - record.lastSentAt >= intervalMs) {
          const result = await trySend(env, key, record, pickRandomMessage(), "./index.html");
          if (result === "removed") { removed++; removedThisRecord = true; }
          else if (result === "sent") { record.lastSentAt = now; dirty = true; sentGeneral++; }
        }
      }

      // ---- Track 2: Islamic Reminders & Challenges (fully separate schedule) ----
      if (!removedThisRecord && prefs.challengeMode && prefs.challengeMode !== "off" && hour === prefs.challengeHour) {
        const dayKey = nowDate.toISOString().split("T")[0]; // e.g. "2026-08-31", in UTC — good enough to dedupe "once per day"
        const alreadySentToday = record.lastDailyChallengeAt && new Date(record.lastDailyChallengeAt).toISOString().split("T")[0] === dayKey;

        if ((prefs.challengeMode === "daily" || prefs.challengeMode === "both") && !alreadySentToday) {
          const result = await trySend(env, key, record, pickRandomDailyChallenge(), "./index.html?open=challenges");
          if (result === "removed") { removed++; removedThisRecord = true; }
          else if (result === "sent") { record.lastDailyChallengeAt = now; dirty = true; sentChallenge++; }
        }

        const localWeekday = (() => {
          try {
            const parts = new Intl.DateTimeFormat("en-US", { timeZone: prefs.timezone, weekday: "short" }).format(nowDate);
            return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts);
          } catch (err) {
            return nowDate.getUTCDay();
          }
        })();
        const weekKey = isoWeekNumber(nowDate) + "-" + nowDate.getUTCFullYear();
        const alreadySentThisWeek = record.lastWeeklyChallengeAt &&
          (isoWeekNumber(new Date(record.lastWeeklyChallengeAt)) + "-" + new Date(record.lastWeeklyChallengeAt).getUTCFullYear()) === weekKey;

        if (!removedThisRecord && (prefs.challengeMode === "weekly" || prefs.challengeMode === "both") &&
            localWeekday === prefs.challengeWeekday && !alreadySentThisWeek) {
          const result = await trySend(env, key, record, currentWeeklyChallenge(), "./index.html?open=challenges");
          if (result === "removed") { removed++; removedThisRecord = true; }
          else if (result === "sent") { record.lastWeeklyChallengeAt = now; dirty = true; sentChallenge++; }
        }
      }

      // ---- Track 3: Prayer-time (Adhan) notifications ----
      if (!removedThisRecord) {
        const prayerResult = await checkPrayerNotifications(env, key, record);
        if (prayerResult.removed) { removed++; removedThisRecord = true; }
        else if (prayerResult.dirty) { dirty = true; sentPrayer += prayerResult.sent; }
      }

      if (dirty && !removedThisRecord) {
        await env.SUBSCRIPTIONS.put(key, JSON.stringify(record));
      }
    }
  } while (cursor);

  console.log(`Scheduled check: processed=${processed} sentGeneral=${sentGeneral} sentChallenge=${sentChallenge} sentPrayer=${sentPrayer} removed=${removed}`);
}

async function handleTestChallenge(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.subscription || !body.subscription.endpoint) {
    return json({ error: "Missing subscription" }, 400);
  }
  try {
    const message = body.kind === "weekly" ? currentWeeklyChallenge() : pickRandomDailyChallenge();
    const res = await sendPushTo(env, body.subscription, message, "./index.html?open=challenges");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({ ok: false, status: res.status, detail: text }, 502);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}

async function handleTestPrayer(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.subscription || !body.subscription.endpoint) {
    return json({ error: "Missing subscription" }, 400);
  }
  try {
    const prayerName = ADHAN_PRAYER_NAMES.includes(body.prayer) ? body.prayer : "Dhuhr";
    const res = await sendPushTo(env, body.subscription, ADHAN_MESSAGES[prayerName], "./index.html?open=qibla");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json({ ok: false, status: res.status, detail: text }, 502);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}

// ---- Accounts (name + password), so journal data can follow someone across
// ---- devices instead of being stuck in one browser's local storage. ----
//
// Passwords are never stored in plain text — only a salted PBKDF2 hash, using
// the Web Crypto API that's built into Cloudflare Workers.

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]));
}
// Turns a username into a stable lookup key: trimmed, lowercased, so
// "Razan" and "razan " are treated as the same account.
function normalizeUsername(name) {
  return String(name || "").trim().toLowerCase();
}
async function hashPassword(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(derived));
}
async function verifyPassword(password, saltB64, hashB64) {
  const saltBytes = base64ToBytes(saltB64);
  const computed = await hashPassword(password, saltBytes);
  // Constant-time-ish comparison — good enough here since this isn't a
  // high-value target, but avoids the most obvious short-circuit timing leak.
  if (computed.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return diff === 0;
}

async function handleSignup(request, env) {
  const body = await request.json().catch(() => null);
  const displayName = body && typeof body.name === "string" ? body.name.trim() : "";
  const password = body && typeof body.password === "string" ? body.password : "";
  if (displayName.length < 2 || displayName.length > 40) {
    return json({ error: "Name must be between 2 and 40 characters." }, 400);
  }
  if (password.length < 6) {
    return json({ error: "Password must be at least 6 characters." }, 400);
  }
  const key = "user:" + normalizeUsername(displayName);
  const existing = await env.USERS.get(key);
  if (existing) {
    return json({ error: "That name is already taken. Try logging in instead, or pick a different name." }, 409);
  }
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToBase64(saltBytes);
  const hash = await hashPassword(password, saltBytes);
  const now = Date.now();
  const record = { displayName, salt, hash, createdAt: now, lastActiveAt: now, journalData: null };
  await env.USERS.put(key, JSON.stringify(record));
  const token = generateToken();
  await env.USERS.put("token:" + token, key);
  return json({ ok: true, token, name: displayName });
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  const displayName = body && typeof body.name === "string" ? body.name.trim() : "";
  const password = body && typeof body.password === "string" ? body.password : "";
  const key = "user:" + normalizeUsername(displayName);
  const raw = await env.USERS.get(key);
  if (!raw) {
    return json({ error: "No account with that name. Check the spelling, or sign up instead." }, 404);
  }
  const record = JSON.parse(raw);
  const ok = await verifyPassword(password, record.salt, record.hash);
  if (!ok) {
    return json({ error: "Incorrect password." }, 401);
  }
  record.lastActiveAt = Date.now();
  await env.USERS.put(key, JSON.stringify(record));
  const token = generateToken();
  await env.USERS.put("token:" + token, key);
  return json({ ok: true, token, name: record.displayName, journalData: record.journalData });
}

async function handleLogout(request, env) {
  const body = await request.json().catch(() => null);
  const token = body && typeof body.token === "string" ? body.token : "";
  if (token) await env.USERS.delete("token:" + token);
  return json({ ok: true });
}

// Every write/read below looks up the account by session token rather than
// trusting a name sent from the client, so one logged-in person can't
// overwrite another person's data just by guessing their name.
async function userKeyForToken(env, token) {
  if (!token) return null;
  return await env.USERS.get("token:" + token);
}

async function handleSyncSave(request, env) {
  const body = await request.json().catch(() => null);
  const token = body && typeof body.token === "string" ? body.token : "";
  const key = await userKeyForToken(env, token);
  if (!key) return json({ error: "Not logged in, or the session expired. Please log in again." }, 401);
  const raw = await env.USERS.get(key);
  if (!raw) return json({ error: "Account not found." }, 404);
  const record = JSON.parse(raw);
  record.journalData = body.journalData;
  record.lastActiveAt = Date.now();
  await env.USERS.put(key, JSON.stringify(record));
  return json({ ok: true });
}

async function handleSyncLoad(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const key = await userKeyForToken(env, token);
  if (!key) return json({ error: "Not logged in, or the session expired. Please log in again." }, 401);
  const raw = await env.USERS.get(key);
  if (!raw) return json({ error: "Account not found." }, 404);
  const record = JSON.parse(raw);
  return json({ ok: true, name: record.displayName, journalData: record.journalData });
}

// A simple, private view of who has signed up — protected by a secret key
// only you know (set with `wrangler secret put ADMIN_KEY`), not exposed to
// regular users. Never returns password hashes or journal contents.
async function handleAdminUsers(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ error: "Not authorized." }, 403);
  }
  const users = [];
  let cursor;
  do {
    const page = await env.USERS.list({ cursor, limit: 1000 });
    cursor = page.cursor;
    for (const { name: k } of page.keys) {
      if (!k.startsWith("user:")) continue;
      const raw = await env.USERS.get(k);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw);
        users.push({ name: record.displayName, createdAt: record.createdAt, lastActiveAt: record.lastActiveAt });
      } catch (err) { /* skip malformed record */ }
    }
  } while (cursor);
  users.sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));
  return json({ ok: true, users });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/vapid-public-key" && request.method === "GET") {
      return json({ publicKey: env.VAPID_PUBLIC_KEY });
    }

    if (url.pathname === "/subscribe" && request.method === "POST") {
      return handleSubscribe(request, env);
    }

    if (url.pathname === "/unsubscribe" && request.method === "POST") {
      return handleUnsubscribe(request, env);
    }

    if (url.pathname === "/test" && request.method === "POST") {
      return handleTestPush(request, env);
    }

    if (url.pathname === "/test-challenge" && request.method === "POST") {
      return handleTestChallenge(request, env);
    }

    if (url.pathname === "/test-prayer" && request.method === "POST") {
      return handleTestPrayer(request, env);
    }

    // ---- Accounts, so journal data can follow someone across devices ----
    if (url.pathname === "/signup" && request.method === "POST") {
      return handleSignup(request, env);
    }
    if (url.pathname === "/login" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/logout" && request.method === "POST") {
      return handleLogout(request, env);
    }
    if (url.pathname === "/sync-save" && request.method === "POST") {
      return handleSyncSave(request, env);
    }
    if (url.pathname === "/sync-load" && request.method === "GET") {
      return handleSyncLoad(request, env);
    }
    if (url.pathname === "/admin/users" && request.method === "GET") {
      return handleAdminUsers(request, env);
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledCheck(env));
  },
};
