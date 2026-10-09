import "server-only";
import { dayKey, getSettings, now, saveSettings } from "./config";
import { db } from "./db";
import { buildFactPack, deceasedNames, renderFacts, type FactPack } from "./facts";
import { generateJson, type ImageInput } from "./gemini";
import { guarded, namesInNote, type GuardContext } from "./guard";
import { toView, type PhotoView } from "./photoView";
import type { Person, Photo } from "./types";

export const EMPTY_DAY_LINE = "Good morning. Shall we look at some old photos together?";

async function imageOf(photo: Photo): Promise<ImageInput | null> {
  const blob = await db.getBlob(photo.path);
  return blob ? { data: blob.data, mimeType: blob.contentType } : null;
}

function guardContext(packs: FactPack[], people: Person[]): GuardContext {
  const enrolledNames = people.flatMap((p) => [p.name, p.nickname].filter((n): n is string => !!n));
  const allowed = new Set<string>();
  for (const pack of packs) {
    for (const p of pack.people) allowed.add(p.name);
    for (const n of namesInNote(pack.note, enrolledNames)) allowed.add(n);
  }
  return { allowedNames: [...allowed], enrolledNames, deceasedNames: deceasedNames(packs) };
}

function peoplePhrase(pack: FactPack): string {
  const names = pack.people.map((p) => p.name);
  if (pack.unknownFaces) names.push("someone with you");
  if (!names.length) return "";
  if (names.length === 1) return ` with ${names[0]}`;
  return ` with ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function templateLine(pack: FactPack, prefix: string): string {
  const where = pack.place ? (pack.place.kind === "saved" ? ` at ${pack.place.label.toLowerCase() === "home" ? "home" : pack.place.label}` : ` in ${pack.place.label}`) : "";
  return `${prefix}${pack.timeOfDay ? ` ${pack.timeOfDay}` : ""} you were${where}${peoplePhrase(pack) || " out and about"}.`;
}

// ---------- Mode 1: yesterday ----------

export type RecapResult =
  | { status: "too_early" | "already" }
  | { status: "empty"; lines: string[] }
  | { status: "recap"; photos: PhotoView[]; lines: string[]; opener: string; focusPhotoId: string; usedFallback: boolean };

function isYesterday(photo: Photo, today: Date): boolean {
  if (photo.source === "yesterday") return true;
  if (photo.source !== "capture" || !photo.exif?.takenAt) return false;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  return dayKey(new Date(photo.exif.takenAt)) === dayKey(y);
}

function pickThree<T>(items: T[]): T[] {
  if (items.length <= 3) return items;
  const last = items.length - 1;
  return [items[0], items[Math.round(last / 2)], items[last]];
}

export async function morningRecap(force: boolean): Promise<RecapResult> {
  const current = await now();
  const settings = await getSettings();
  const today = dayKey(current);
  if (!force) {
    if (current.getHours() < 7) return { status: "too_early" };
    if (settings.recapLastPlayedDay === today) return { status: "already" };
  }

  const [photos, people] = await Promise.all([db.list<Photo>("photos"), db.list<Person>("people")]);
  const yesterday = photos
    .filter((p) => isYesterday(p, current))
    .sort((a, b) => (a.exif?.takenAt ?? a.uploadedAt).localeCompare(b.exif?.takenAt ?? b.uploadedAt));

  await saveSettings({ recapLastPlayedDay: today });
  if (!yesterday.length) return { status: "empty", lines: [EMPTY_DAY_LINE] };

  const chosen = pickThree(yesterday);
  const packs = chosen.map((p) => buildFactPack(p, people, { includeYear: false }));
  // Opening photo: most enrolled faces, ties go to the latest photo.
  let focus = 0;
  packs.forEach((pack, i) => {
    if (pack.people.length >= packs[focus].people.length) focus = i;
  });

  const images = (await Promise.all(chosen.map(imageOf))).filter((i): i is ImageInput => !!i);
  const factsText = packs.map((pack, i) => renderFacts(pack, `PHOTO ${i + 1}`)).join("\n\n");
  const ctx = guardContext(packs, people);

  const { value, usedFallback } = await guarded(
    (feedback) =>
      generateJson<{ lines: string[]; opener: string }>({
        images,
        schema: {
          type: "object",
          properties: {
            lines: { type: "array", items: { type: "string" }, description: "Exactly one sentence per photo, in order." },
            opener: { type: "string" },
          },
          required: ["lines", "opener"],
        },
        prompt: `It is the morning. Gently tell the person about yesterday, using these ${chosen.length} photos (images attached in the same order).

${factsText}

Write:
- "lines": exactly ${chosen.length} short sentences, one per photo, in time order. The first starts with "Yesterday". Use only: the time of day, the place, the recognised people, and the activity or objects you can plainly see. Do not guess why anything happened, what happened between photos, or how anyone felt.
- "opener": about PHOTO ${focus + 1}, one warm sentence noticing something visible, then one easy open question with no right answer (for example "What do you like about the park?"). Never ask who someone is, or whether they remember.
${feedback ?? ""}`,
      }),
    (out) => [...out.lines, out.opener],
    ctx,
    () => ({
      lines: packs.map((pack, i) => templateLine(pack, i === 0 ? "Yesterday" : "Later")),
      opener: "That looks like a nice moment. What do you like about this one?",
    }),
  );

  return {
    status: "recap",
    photos: chosen.map((p) => toView(p, people)),
    lines: value.lines.slice(0, chosen.length),
    opener: value.opener,
    focusPhotoId: chosen[focus].id,
    usedFallback,
  };
}

// ---------- Mode 2: a tapped photo ----------

async function loadPhoto(photoId: string) {
  const [photo, people] = await Promise.all([db.get<Photo>("photos", photoId), db.list<Person>("people")]);
  if (!photo) throw new Error("Photo not found");
  const pack = buildFactPack(photo, people, { includeYear: photo.source === "album" });
  const image = await imageOf(photo);
  return { photo, people, pack, image, ctx: guardContext([pack], people) };
}

const OPEN_RULES = `Rules for this photo:
- The carer note is the truth for who, where and what. If the note and the metadata disagree, use the note.
- Name only the recognised people, or people named in the note. If the note names more people than were recognised, you may name them from the note but never say which face is which.
- Unrecognised faces are only "someone with you".
- The image may add visual detail (setting, an object, an expression), but never a new person, place or event. If you notice something not in the note (like a dog), you may mention it lightly as something you can see, not as part of the story.
- For anyone who has passed away: past tense, gentle, never as if they are visiting or can be called.
- If there is no note, no recognised person and no metadata: describe what you see and ask an easy question. Name no one, give no place or date.`;

export async function openPhoto(photoId: string): Promise<{ opener: string; usedFallback: boolean }> {
  const { pack, image, ctx } = await loadPhoto(photoId);
  const { value, usedFallback } = await guarded(
    (feedback) =>
      generateJson<{ opener: string }>({
        images: image ? [image] : [],
        schema: { type: "object", properties: { opener: { type: "string" } }, required: ["opener"] },
        prompt: `The person tapped this photo on their photo frame. Start a gentle conversation about it.

${renderFacts(pack)}

${OPEN_RULES}

Write "opener": 1-2 short sentences. Speak first with a warm observation grounded in the facts, then one easy open question with no right answer.
${feedback ?? ""}`,
      }),
    (out) => [out.opener],
    ctx,
    () => ({
      opener: pack.note
        ? `This is a lovely one: ${pack.note.replace(/\.$/, "")}. What do you like about it?`
        : "What a lovely photo. What catches your eye in this one?",
    }),
  );
  return { opener: value.opener, usedFallback };
}

export type Turn = { role: "companion" | "person"; text: string };

export async function replyAboutPhoto(
  photoId: string,
  history: Turn[],
  closing: boolean,
): Promise<{ reply: string; usedFallback: boolean }> {
  const { pack, image, ctx } = await loadPhoto(photoId);
  const transcript = history.map((t) => `${t.role === "person" ? "Person" : "You"}: ${t.text}`).join("\n");
  const { value, usedFallback } = await guarded(
    (feedback) =>
      generateJson<{ reply: string }>({
        images: image ? [image] : [],
        schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
        prompt: `You are chatting with the person about this photo on their frame.

${renderFacts(pack)}

${OPEN_RULES}
- If they remember it differently from the note, go along with their version warmly. Do not correct them, and do not repeat the note at them.
- If they seem unsure or upset, reassure gently and keep it light.

Conversation so far:
${transcript}

${
  closing
    ? 'Write "reply": one warm closing sentence that thanks them for sharing and ends the chat. No question.'
    : 'Write "reply": 1-2 short sentences that respond to what they said, then at most one easy open question.'
}
${feedback ?? ""}`,
      }),
    (out) => [out.reply],
    ctx,
    () => ({
      reply: closing ? "Thank you for sharing that with me. It's a lovely photo." : "That sounds lovely. Tell me a little more?",
    }),
  );
  return { reply: value.reply, usedFallback };
}
