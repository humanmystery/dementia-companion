import "server-only";
import { db, newId, type Collection } from "./db";
import { now, saveProfile, saveSettings } from "./config";
import type { Person, Photo, ReminderPhrase, ScheduleItem, Task } from "./types";

export const DEMO_TASKS: Omit<Task, "id" | "createdAt">[] = [
  {
    name: "Ironing clothes",
    sceneHints:
      "An ironing board with an iron on it, clothes being ironed, a pile of ironed clothes on a chair nearby.",
    steps: ["Iron the shirt on the board", "Fold the ironed clothes on the chair", "Switch the iron off"],
    confirmed: true,
  },
  {
    name: "Preparing rice",
    sceneHints:
      "A rice cooker on the kitchen counter, a bowl of measured dry rice beside it, rice not yet rinsed.",
    steps: ["Rinse the rice in the bowl", "Put the rice and water into the rice cooker", "Press the cook button"],
    confirmed: true,
  },
  {
    name: "Folding towels",
    sceneHints: "A pile of clean towels on a table, some folded and some not.",
    steps: [
      "Take one towel from the pile and fold it in half",
      "Fold it in half again",
      "Put the folded towel on the stack",
    ],
    confirmed: true,
  },
];

export const DEMO_PHRASES = [
  "Shall we take a photo?",
  "Would you like to take a photo?",
  "Shall we keep a little memory from today?",
  "Would you like to keep a photo from now?",
  "Shall we take one?",
];

const ALL: Collection[] = [
  "people",
  "places",
  "photos",
  "tasks",
  "schedule",
  "phrases",
  "reminderEvents",
  "faceCooldowns",
  "liveSessions",
  "config",
];

export async function resetAll() {
  const photos = await db.list<Photo>("photos");
  await Promise.all(photos.map((p) => db.removeBlob(p.path)));
  const people = await db.list<Person>("people");
  await Promise.all(people.flatMap((p) => p.refPhotoPaths.map((r) => db.removeBlob(r))));
  for (const col of ALL) {
    const docs = await db.list<{ id: string }>(col);
    await Promise.all(docs.map((d) => db.remove(col, d.id)));
  }
}

/** Text-only demo setup. People and photos are added through the carer page (faces are computed in the browser). */
export async function seedDemo() {
  await saveProfile({
    name: "Grace",
    gender: "female",
    age: 78,
    livingAlone: true,
    livingDetails: "Lives alone in a flat; daughter Mei visits most evenings.",
    regularActivities: ["Ironing on Fridays", "Cooking rice for lunch", "Folding laundry after washing"],
    attentionEvents: ["Doctor's appointment with Dr. Chan"],
    stage: "early",
  });
  await saveSettings({});

  for (const t of await db.list<Task>("tasks")) await db.remove("tasks", t.id);
  for (const t of DEMO_TASKS) {
    await db.set<Task>("tasks", { ...t, id: newId(), createdAt: new Date().toISOString() });
  }

  const current = await now();
  const appt = new Date(current.getTime() + 60 * 60 * 1000);
  for (const s of await db.list<ScheduleItem>("schedule")) await db.remove("schedule", s.id);
  await db.set<ScheduleItem>("schedule", {
    id: newId(),
    title: "Appointment with Dr. Chan",
    time: toLocalInput(appt),
    carerWording: "You have an appointment with Dr. Chan soon",
    confirmed: true,
  });

  for (const p of await db.list<ReminderPhrase>("phrases")) await db.remove("phrases", p.id);
  for (const text of DEMO_PHRASES) {
    await db.set<ReminderPhrase>("phrases", { id: newId(), text, approved: true, createdAt: new Date().toISOString() });
  }
}

export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
