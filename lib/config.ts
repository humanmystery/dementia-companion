import "server-only";
import { db } from "./db";
import type { Profile, Settings } from "./types";

const DEFAULT_SETTINGS: Settings = {
  activeHours: { start: "09:00", end: "20:00" },
  remindersEnabled: true,
  intervalMin: 120,
  jitterMin: 20,
  maxPerDay: 6,
  fakeClock: null,
  recapLastPlayedDay: null,
};

const DEFAULT_PROFILE: Profile = { regularActivities: [], attentionEvents: [] };

export async function getSettings(): Promise<Settings> {
  const doc: Partial<Settings> & { id?: string } = (await db.get<Settings & { id: string }>("config", "settings")) ?? {};
  delete doc.id;
  return { ...DEFAULT_SETTINGS, ...doc };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await db.set("config", { id: "settings", ...next });
  return next;
}

export async function getProfile(): Promise<Profile> {
  const doc: Partial<Profile> & { id?: string } = (await db.get<Profile & { id: string }>("config", "profile")) ?? {};
  delete doc.id;
  return { ...DEFAULT_PROFILE, ...doc };
}

export async function saveProfile(patch: Partial<Profile>): Promise<Profile> {
  const next = { ...(await getProfile()), ...patch };
  next.regularActivities = next.regularActivities.map((s) => s.trim()).filter(Boolean);
  next.attentionEvents = next.attentionEvents.map((s) => s.trim()).filter(Boolean);
  await db.set("config", { id: "profile", ...next });
  return next;
}

/** The demo clock. When the carer sets a fake clock, "now" is that wall-clock time, moving forward in real time. */
export async function now(): Promise<Date> {
  const s = await getSettings();
  if (!s.fakeClock) return new Date();
  const [base, setAt] = s.fakeClock.split("|");
  const offset = Date.now() - Number(setAt || Date.now());
  return new Date(new Date(base).getTime() + offset);
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}
