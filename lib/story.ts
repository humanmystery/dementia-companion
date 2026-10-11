import "server-only";
import { dayKey, getSettings, now, saveSettings } from "./config";
import { db } from "./db";
import { buildFactPack, deceasedNames, renderFacts, type FactPack } from "./facts";
import { generateJson, PERSONA, type ImageInput } from "./gemini";
import { checkText, guarded, namesInNote, type GuardContext } from "./guard";
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
  | {
      status: "recap";
      photos: PhotoView[];
      lines: string[];
      summary: string;
      opener: string;
      focusPhotoId: string;
      usedFallback: boolean;
    };

const MAX_RECAP_PHOTOS = 6;

function isYesterday(photo: Photo, today: Date): boolean {
  if (photo.source === "yesterday") return true;
  if (photo.source !== "capture" || !photo.exif?.takenAt) return false;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  return dayKey(new Date(photo.exif.takenAt)) === dayKey(y);
}

/** Spread the picks across the whole day, always keeping the first and last photo. */
function pickAcrossDay<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const last = items.length - 1;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * last) / (max - 1))]);
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

  const chosen = pickAcrossDay(yesterday, MAX_RECAP_PHOTOS);
  const packs = chosen.map((p) => buildFactPack(p, people, { includeYear: false }));
  // If Gemini's pick is unusable: most enrolled faces, ties go to the latest photo.
  let fallbackFocus = 0;
  packs.forEach((pack, i) => {
    if (pack.people.length >= packs[fallbackFocus].people.length) fallbackFocus = i;
  });

  const images = (await Promise.all(chosen.map(imageOf))).filter((i): i is ImageInput => !!i);
  const factsText = packs.map((pack, i) => renderFacts(pack, `PHOTO ${i + 1}`)).join("\n\n");
  const ctx = guardContext(packs, people);
  const n = chosen.length;

  const { value, usedFallback } = await guarded(
    (feedback) =>
      generateJson<{ lines: string[]; summary: string; chatPhoto: number; opener: string }>({
        images,
        schema: {
          type: "object",
          properties: {
            lines: { type: "array", items: { type: "string" }, description: "Exactly one entry per photo, in order." },
            summary: { type: "string" },
            chatPhoto: { type: "integer", minimum: 1, maximum: n },
            opener: { type: "string" },
          },
          required: ["lines", "summary", "chatPhoto", "opener"],
        },
        prompt: `It is the morning. Tell the person the little story of their own day yesterday, using these ${n} photos they took (images attached in the same order). Then pick one photo to chat about.

${factsText}

Write:
- "lines": exactly ${n} entries, one per photo, in time order. Each is 1-2 short sentences. The first starts with "Yesterday". Link them so it sounds like one gentle story ("Then...", "Later on...", "In the evening..."). The person took these photos themselves, so it is THEIR day: every line is about where "you" were and who "you" were with ("you and Bee sat outside a cafe"), never about what other people did without them. Use only: the time of day, the place, the recognised people, and the activity or objects you can plainly see. Do not guess why anything happened, what happened between photos, or how anyone felt.
- "summary": one short warm sentence that wraps up the day, about the day itself. No new facts and no one's feelings (for example "What a full day that was.").
- "chatPhoto": the number of the photo that is easiest and nicest to chat about. Prefer one with recognised people who are alive and a clear, pleasant activity. Avoid blurry or empty scenes.
- "opener": about that photo, one warm sentence noticing something visible, then one easy, playful open question with no right answer (for example "What do you like about the park?"). Never ask who someone is, or whether they remember.
${feedback ?? ""}`,
      }),
    (out) => [...out.lines, out.summary, out.opener],
    ctx,
    () => ({
      lines: packs.map((pack, i) => templateLine(pack, i === 0 ? "Yesterday" : "Later")),
      summary: "That was yesterday.",
      chatPhoto: fallbackFocus + 1,
      opener: "That looks like a nice moment. What do you like about this one?",
    }),
  );

  const lines = value.lines.slice(0, n);
  while (lines.length < n) lines.push(templateLine(packs[lines.length], "Later"));
  const pick = Number.isInteger(value.chatPhoto) && value.chatPhoto >= 1 && value.chatPhoto <= n ? value.chatPhoto - 1 : fallbackFocus;

  return {
    status: "recap",
    photos: chosen.map((p) => toView(p, people)),
    lines,
    summary: value.summary,
    opener: value.opener,
    focusPhotoId: chosen[pick].id,
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

const CHAT_RULES = `- If they remember it differently from the note, go along with their version warmly. Do not correct them, and do not repeat the note at them.
- If they seem unsure or upset, reassure gently and keep it light.`;

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
      opener:
        pack.people.length === 1 && !pack.people[0].deceased
          ? `Here's ${pack.people[0].name}. What do you like about this one?`
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
${CHAT_RULES}

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

// ---------- Mode 2 over Gemini Live ----------

export type LiveSetup = {
  systemInstruction: string;
  image: { mimeType: string; data: string } | null;
  opener: string;
};

/** Everything the Live session starts with. Built here so the facts and rules never pass through the browser. */
export async function liveSetup(photoId: string, opener: string): Promise<LiveSetup> {
  const { pack, image } = await loadPhoto(photoId);
  const systemInstruction = `${PERSONA}

You are speaking out loud with the person about one photo on their photo frame. The photo is attached at the start of the conversation.

${renderFacts(pack)}

${OPEN_RULES}
${CHAT_RULES}
- You have already said the opening line. Do not repeat it or greet them again.
- Each time, answer what they said in 1-2 short sentences, then at most one easy open question. Speak slowly and warmly.
- If they are quiet, wait. Do not fill the silence.
- If they want to stop, say one short warm goodbye with no question.`;
  return {
    systemInstruction,
    image: image ? { mimeType: image.mimeType, data: image.data.toString("base64") } : null,
    opener,
  };
}

/** Checks each companion line of a saved Live chat with the same rules as the generated lines. */
export async function flagLiveTurns<T extends { role: string; text: string }>(photoId: string, turns: T[]) {
  const { ctx } = await loadPhoto(photoId);
  return turns.map((t) => {
    const flags = t.role === "companion" ? checkText(t.text, ctx) : [];
    return flags.length ? { ...t, flags } : t;
  });
}
