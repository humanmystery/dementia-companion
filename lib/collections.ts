import "server-only";
import { crudHandlers } from "./crud";
import type { ReminderPhrase, ScheduleItem, Task } from "./types";

export const tasksCrud = crudHandlers<Task>("tasks", (b, existing) => {
  if (!b.name?.trim()) throw new Error("Task name is required");
  return {
    name: b.name.trim(),
    sceneHints: (b.sceneHints ?? "").trim(),
    steps: (b.steps ?? []).map((s) => s.trim()).filter(Boolean),
    confirmed: !!b.confirmed,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
});

export const scheduleCrud = crudHandlers<ScheduleItem>("schedule", (b) => {
  if (!b.title?.trim() || !b.time) throw new Error("Title and time are required");
  return {
    title: b.title.trim(),
    time: b.time,
    carerWording: b.carerWording?.trim() || undefined,
    confirmed: !!b.confirmed,
  };
});

export const phrasesCrud = crudHandlers<ReminderPhrase>("phrases", (b, existing) => {
  if (!b.text?.trim()) throw new Error("Text is required");
  return {
    text: b.text.trim(),
    slot: b.slot ?? "any",
    approved: !!b.approved,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
});
