import "server-only";
import { createHash } from "crypto";
import { dayKey, getSettings, minutesOfDay, now } from "./config";
import { db, newId } from "./db";
import { adminApp } from "./firebaseAdmin";
import { generateJson } from "./gemini";
import type { PushToken, ReminderEvent, ReminderPhrase, Settings } from "./types";

type Slot = NonNullable<ReminderPhrase["slot"]>;

export function slotOf(d: Date): Slot {
  const h = d.getHours();
  if (h < 11) return "morning";
  if (h < 14) return "midday";
  if (h < 17) return "afternoon";
  return "evening";
}

/** Deterministic jitter in [-j, +j] minutes for a given day and reminder number, so 15-minute ticks agree. */
function jitterFor(day: string, n: number, j: number): number {
  if (!j) return 0;
  const h = createHash("sha1").update(`${day}:${n}`).digest().readUInt32BE(0);
  return Math.round(((h / 0xffffffff) * 2 - 1) * j);
}

/** Pure scheduling decision. No AI involved. */
export function nextDueMinute(settings: Settings, day: string, firedToday: number): number {
  const start = minutesOfDay(settings.activeHours.start);
  return start + firedToday * settings.intervalMin + jitterFor(day, firedToday, settings.jitterMin);
}

export function isDue(settings: Settings, current: Date, eventsToday: ReminderEvent[]): boolean {
  if (!settings.remindersEnabled) return false;
  const minute = current.getHours() * 60 + current.getMinutes();
  if (minute < minutesOfDay(settings.activeHours.start) || minute > minutesOfDay(settings.activeHours.end)) return false;
  if (eventsToday.length >= settings.maxPerDay) return false;
  const last = eventsToday.at(-1);
  // Never prompt again within an hour, even if the schedule has drifted.
  if (last && current.getTime() - new Date(last.firedAt).getTime() < 60 * 60_000) return false;
  return minute >= nextDueMinute(settings, dayKey(current), eventsToday.length);
}

async function pickPhrase(current: Date, lastText?: string): Promise<string> {
  const approved = (await db.list<ReminderPhrase>("phrases")).filter((p) => p.approved);
  const slot = slotOf(current);
  const fitting = approved.filter((p) => (p.slot ?? "any") === "any" || p.slot === slot);
  const pool = (fitting.length ? fitting : approved).filter((p) => p.text !== lastText);
  if (!pool.length) return "Shall we take a photo?";
  return pool[Math.floor(Math.random() * pool.length)].text;
}

async function eventsForDay(day: string): Promise<ReminderEvent[]> {
  return (await db.list<ReminderEvent>("reminderEvents"))
    .filter((e) => e.day === day)
    .sort((a, b) => a.firedAt.localeCompare(b.firedAt));
}

async function sendPush(text: string, eventId: string): Promise<number> {
  const tokens = await db.list<PushToken>("pushTokens");
  if (!tokens.length || process.env.DATA_BACKEND !== "firestore") return 0;
  try {
    const { getMessaging } = await import("firebase-admin/messaging");
    const res = await getMessaging(await adminApp()).sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      notification: { title: "Your companion", body: text },
      data: { eventId, kind: "photo-reminder" },
      webpush: { fcmOptions: { link: `/capture?mode=photo&reminder=${eventId}` } },
    });
    res.responses.forEach((r, i) => {
      if (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code ?? "")) {
        void db.remove("pushTokens", tokens[i].id);
      }
    });
    return res.successCount;
  } catch (e) {
    console.error("FCM send failed", e);
    return 0;
  }
}

export async function fireReminder(current: Date): Promise<ReminderEvent> {
  const day = dayKey(current);
  const today = await eventsForDay(day);
  // An unanswered earlier reminder just counts as ignored; we never re-ask it.
  for (const e of today.filter((e) => e.status === "pending")) {
    await db.update<ReminderEvent>("reminderEvents", e.id, { status: "ignored" });
  }
  const event: ReminderEvent = {
    id: newId(),
    text: await pickPhrase(current, today.at(-1)?.text),
    firedAt: current.toISOString(),
    day,
    status: "pending",
  };
  await db.set("reminderEvents", event);
  await sendPush(event.text, event.id);
  return event;
}

export async function tick(force = false): Promise<{ fired: ReminderEvent | null }> {
  const current = await now();
  const settings = await getSettings();
  const today = await eventsForDay(dayKey(current));
  if (!force && !isDue(settings, current, today)) return { fired: null };
  return { fired: await fireReminder(current) };
}

export async function pendingReminder(): Promise<ReminderEvent | null> {
  const current = await now();
  const today = await eventsForDay(dayKey(current));
  const last = today.at(-1);
  if (!last || last.status !== "pending") return null;
  if (current.getTime() - new Date(last.firedAt).getTime() > 30 * 60_000) return null;
  return last;
}

export async function answerReminder(id: string, accepted: boolean) {
  return db.update<ReminderEvent>("reminderEvents", id, { status: accepted ? "accepted" : "declined" });
}

export async function draftPhrases(): Promise<ReminderPhrase[]> {
  const out = await generateJson<{ phrases: { text: string; slot: Slot }[] }>({
    schema: {
      type: "object",
      properties: {
        phrases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              slot: { type: "string", enum: ["morning", "midday", "afternoon", "evening", "any"] },
            },
            required: ["text", "slot"],
          },
        },
      },
      required: ["phrases"],
    },
    temperature: 0.9,
    prompt: `Write 10 gentle invitations a friendly companion could say to an older person to take a photo of the moment.
Tone: warm, a little playful, like a friend in the room, e.g. "Shall we take a photo?", "Shall we keep a little memory from today?".
Some can fit a time of day (morning, midday, afternoon, evening - e.g. "Shall we take a photo of dinner?"), others "any".
Each under 10 words, a question, always easy to say no to.
Never: "Photo reminder", "Take a photo now", "You have not taken a photo", "required", or anything that sounds like an alarm or a test.`,
  });
  const created: ReminderPhrase[] = [];
  for (const p of out.phrases ?? []) {
    created.push(
      await db.set<ReminderPhrase>("phrases", {
        id: newId(),
        text: p.text,
        slot: p.slot,
        approved: false,
        createdAt: new Date().toISOString(),
      }),
    );
  }
  return created;
}
