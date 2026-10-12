import "server-only";
import { dayKey, getProfile, getSettings, now, saveSettings } from "./config";
import { markTalkedAbout, moveOnDayPhotos, recapDayOf } from "./dayPhotos";
import { db } from "./db";
import { buildFactPack, deceasedNames, renderFacts, timeOfDay, type FactPack } from "./facts";
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

function companions(pack: FactPack): string {
  const names = pack.people.map((p) => p.name);
  if (pack.unknownFaces) names.push(names.length ? "someone else" : "someone");
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Safe line built only from the facts, told from behind the camera like the generated ones. */
function templateLine(pack: FactPack, index: number): string {
  const lead = index === 0 ? `Yesterday${pack.timeOfDay ? ` ${pack.timeOfDay}` : ""}` : `Then${pack.timeOfDay ? `, ${pack.timeOfDay}` : ""}`;
  const where = pack.place
    ? pack.place.kind === "saved"
      ? ` at ${pack.place.label.toLowerCase() === "home" ? "home" : pack.place.label}`
      : ` in ${pack.place.label}`
    : "";
  const who = companions(pack);
  const body = where || who ? `you were${where}${who ? ` with ${who}` : ""}` : "you took this photo";
  return `${lead}, ${body}.`;
}

/** Safe opener built only from the fact pack (no invented names or places). */
function fallbackOpener(pack: FactPack): string {
  const living = pack.people.filter((p) => !p.deceased);
  const deceasedOnly = pack.people.length === 1 && pack.people[0].deceased ? pack.people[0] : null;
  const placeLabel = pack.place
    ? pack.place.kind === "saved" && pack.place.label.toLowerCase() === "home"
      ? "home"
      : pack.place.label
    : null;
  const prep = pack.place?.kind === "saved" ? "at" : "in";

  if (living.length === 1 && placeLabel) {
    return `Here's ${living[0].name} ${prep} ${placeLabel}. What do you like about this one?`;
  }
  if (living.length === 1) return `Here's ${living[0].name}. What do you like about this one?`;
  if (deceasedOnly && placeLabel) {
    return `A lovely photo of ${deceasedOnly.name} ${prep} ${placeLabel}. What do you like about this one?`;
  }
  if (deceasedOnly) return `A lovely photo of ${deceasedOnly.name}. What do you like about this one?`;
  if (placeLabel) return `This one looks like ${placeLabel}. What do you like about it?`;
  return "What a lovely photo. What catches your eye in this one?";
}

function templateOpener(pack: FactPack): string {
  return fallbackOpener(pack);
}

// ---------- Mode 1: yesterday ----------

export type RecapResult =
  | { status: "too_early" | "already" | "missed" }
  | { status: "empty"; lines: string[] }
  | {
      status: "recap";
      photos: PhotoView[];
      lines: string[];
      opener: string;
      focusPhotoId: string;
      usedFallback: boolean;
    };

// Short enough to follow: a few photos, then straight into the chat.
const MAX_RECAP_PHOTOS = 4;
const NEAR_DUPLICATE_MS = 10 * 60_000;
// The recap belongs to the morning; if it hasn't happened by noon, the day carries on with the old photos.
const RECAP_FROM_HOUR = 7;
const RECAP_UNTIL_HOUR = 12;
const isMorning = (d: Date) => d.getHours() >= RECAP_FROM_HOUR && d.getHours() < RECAP_UNTIL_HOUR;

const isYesterday = (photo: Photo, today: Date) => recapDayOf(photo) === dayKey(today);

const takenMs = (p: Photo) => Date.parse(p.exif?.takenAt ?? p.uploadedAt);

/** Recognised people count most, then a carer note, then any face at all. */
function recapScore(p: Photo): number {
  const matches = p.faceMatches ?? [];
  return 3 * matches.filter((m) => m.personId).length + (p.note ? 2 : 0) + (matches.some((m) => !m.personId) ? 1 : 0);
}

/**
 * Picks by content, not position: the best photo from each part of the day first, then the next best of the rest.
 * Near-duplicates (taken within a few minutes of a pick) and photos whose image can't be loaded are skipped, so
 * every description always has its own image.
 */
async function pickRecapPhotos(photos: Photo[]): Promise<{ photo: Photo; image: ImageInput }[]> {
  const ranked = [...photos].sort((a, b) => recapScore(b) - recapScore(a) || takenMs(a) - takenMs(b));
  const bestOfEachPart = new Map<string, Photo>();
  for (const p of ranked) {
    const part = timeOfDay(new Date(takenMs(p)));
    if (!bestOfEachPart.has(part)) bestOfEachPart.set(part, p);
  }
  const lead = [...bestOfEachPart.values()];
  const picked: { photo: Photo; image: ImageInput }[] = [];
  for (const photo of [...lead, ...ranked.filter((p) => !lead.includes(p))]) {
    if (picked.length >= MAX_RECAP_PHOTOS) break;
    if (picked.some((x) => Math.abs(takenMs(x.photo) - takenMs(photo)) < NEAR_DUPLICATE_MS)) continue;
    const image = await imageOf(photo);
    if (image) picked.push({ photo, image });
  }
  return picked.sort((a, b) => takenMs(a.photo) - takenMs(b.photo));
}

/** Whether the frame should greet them with the morning invitation right now. */
export async function recapStatus(): Promise<{ due: boolean; greeting: string; hasYesterday: boolean }> {
  await moveOnDayPhotos();
  const [current, settings, profile, photos] = await Promise.all([now(), getSettings(), getProfile(), db.list<Photo>("photos")]);
  const name = profile.name?.trim();
  return {
    due: isMorning(current) && settings.recapLastPlayedDay !== dayKey(current),
    greeting: `Good morning${name ? `, ${name}` : ""}`,
    hasYesterday: photos.some((p) => isYesterday(p, current)),
  };
}

export async function morningRecap(force: boolean): Promise<RecapResult> {
  await moveOnDayPhotos();
  const current = await now();
  const settings = await getSettings();
  const today = dayKey(current);
  if (!force) {
    if (current.getHours() < RECAP_FROM_HOUR) return { status: "too_early" };
    if (current.getHours() >= RECAP_UNTIL_HOUR) return { status: "missed" };
    if (settings.recapLastPlayedDay === today) return { status: "already" };
  }

  const [photos, people] = await Promise.all([db.list<Photo>("photos"), db.list<Person>("people")]);
  const yesterday = photos.filter((p) => isYesterday(p, current));

  await saveSettings({ recapLastPlayedDay: today });
  const picked = yesterday.length ? await pickRecapPhotos(yesterday) : [];
  if (!picked.length) return { status: "empty", lines: [EMPTY_DAY_LINE] };

  const chosen = picked.map((x) => x.photo);
  const packs = chosen.map((p) => buildFactPack(p, people, { includeYear: false }));
  // If Gemini's pick is unusable: most enrolled faces, ties go to the latest photo.
  let fallbackFocus = 0;
  packs.forEach((pack, i) => {
    if (pack.people.length >= packs[fallbackFocus].people.length) fallbackFocus = i;
  });

  const ctx = guardContext(packs, people);
  const n = chosen.length;
  const draft = await draftRecap(picked.map((x) => x.image), packs, ctx);

  // Keep every line that passes the checks; only the ones that don't fall back to the safe template.
  const safe = (text: string | undefined): text is string => !!text?.trim() && !checkText(text, ctx).length;
  const lines = packs.map((pack, i) => (safe(draft?.lines[i]) ? draft.lines[i] : templateLine(pack, i)));
  const validPick = !!draft && Number.isInteger(draft.chatPhoto) && draft.chatPhoto >= 1 && draft.chatPhoto <= n;
  const pick = validPick ? draft.chatPhoto - 1 : fallbackFocus;
  const opener = validPick && safe(draft.opener) ? draft.opener : templateOpener(packs[pick]);

  return {
    status: "recap",
    photos: chosen.map((p) => toView(p, people)),
    lines,
    opener,
    focusPhotoId: chosen[pick].id,
    usedFallback: lines.some((l, i) => l !== draft?.lines[i]) || opener !== draft?.opener,
  };
}

type RecapDraft = { lines: string[]; chatPhoto: number; opener: string };

/** Up to two tries; the second gets the first try's rule breaks as feedback. Returns the last draft it got. */
async function draftRecap(images: ImageInput[], packs: FactPack[], ctx: GuardContext): Promise<RecapDraft | null> {
  const n = packs.length;
  const factsText = packs.map((pack, i) => renderFacts(pack, `PHOTO ${i + 1}`)).join("\n\n");
  let draft: RecapDraft | null = null;
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      draft = await generateJson<RecapDraft>({
        images,
        schema: {
          type: "object",
          properties: {
            lines: { type: "array", items: { type: "string" }, description: "Exactly one entry (1-2 short sentences) per photo, in order." },
            chatPhoto: { type: "integer", minimum: 1, maximum: n },
            opener: { type: "string" },
          },
          required: ["lines", "chatPhoto", "opener"],
        },
        prompt: `It is the morning. Tell the person a short, gentle story of their own day yesterday, using these ${n} photos they took (images attached in the same order). Then pick one photo to chat about.

${factsText}

Write:
- "lines": exactly ${n} entries, one per photo, in time order. Each is 1-2 short sentences: where you were and who with, then, if there's something nice to notice, one detail you can see. The first starts with "Yesterday". Link them so it sounds like one story ("Then...", "Later on...", "In the evening..."). The person took these photos themselves, so it is THEIR day: every line is about where "you" were and who "you" were with ("you and Bee sat outside a cafe"), never about what other people did without them. Use only: the time of day, the place, the recognised people, and the activity or objects you can plainly see. Do not guess why anything happened, what happened between photos, or how anyone felt. If a photo is blurry or hard to make out, keep its sentence to the time and place.
- "chatPhoto": the number of the photo that is easiest and nicest to chat about. Prefer one with recognised people who are alive and a clear, pleasant activity. Avoid blurry or empty scenes.
- "opener": about that photo, one warm sentence noticing something visible, then one easy, playful open question with no right answer (for example "What do you like about the park?"). Never ask who someone is, or whether they remember.
${feedback}`,
      });
    } catch {
      continue;
    }
    const problems = [...draft.lines, draft.opener].flatMap((t) => checkText(t, ctx));
    if (!problems.length) break;
    feedback = `Your previous answer broke these rules: ${problems.join("; ")}. Rewrite it following the rules exactly.`;
  }
  return draft;
}

// ---------- Mode 2: a tapped photo ----------

async function loadPhoto(photoId: string) {
  const [photo, people] = await Promise.all([db.get<Photo>("photos", photoId), db.list<Person>("people")]);
  if (!photo) throw new Error("Photo not found");
  const pack = buildFactPack(photo, people, { includeYear: photo.source === "album" && !photo.movedFrom });
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
    () => ({ opener: fallbackOpener(pack) }),
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
  if (history.some((t) => t.role === "person" && t.text.trim())) await markTalkedAbout(photoId);
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
    ? 'Write "reply": one warm closing sentence that gently refers to something they shared in the conversation (their words, not a new guess), thanks them for looking with you, and ends the chat. No question.'
    : 'Write "reply": 1-2 short sentences that respond to what they said, then at most one easy open question.'
}
${feedback ?? ""}`,
      }),
    (out) => [out.reply],
    ctx,
    () => {
      const lastSaid = [...history].reverse().find((t) => t.role === "person")?.text?.trim();
      const hint = lastSaid && lastSaid.length < 80 ? ` I liked hearing about that.` : "";
      return {
        reply: closing
          ? `Thank you for sharing that with me.${hint} It's a lovely photo.`
          : "That sounds lovely. Tell me a little more?",
      };
    },
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
