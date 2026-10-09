import { errorResponse } from "@/lib/carerAuth";
import { db } from "@/lib/db";
import { matchFaces, type DetectedFace } from "@/lib/faceMatch";
import { generateJson } from "@/lib/gemini";
import { guarded } from "@/lib/guard";
import type { FaceCooldown, Person } from "@/lib/types";

const COOLDOWN_MS = Number(process.env.FACE_COOLDOWN_SEC || 60) * 1000;

function relationshipPhrase(rel: string) {
  return /^(your|my)\b/i.test(rel) ? rel.replace(/^my\b/i, "your") : `your ${rel}`;
}

/**
 * The raw camera image never reaches the server: the browser sends face descriptors only.
 * Identity comes from matching against the carer's enrolled set; Gemini only phrases the cue.
 */
export async function POST(req: Request) {
  try {
    const { faces, contextMode } = (await req.json()) as { faces: DetectedFace[]; contextMode?: boolean };
    if (!faces?.length) {
      return Response.json({ status: "no_face", text: "I can't quite see a face. Shall we try once more?" });
    }
    const people = await db.list<Person>("people");
    const matches = matchFaces(faces, people);
    const known = matches
      .filter((m) => m.personId)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];

    if (!known) {
      return Response.json({ status: "unknown", text: "I'm not quite sure who that is." });
    }

    const person = people.find((p) => p.id === known.personId)!;
    const cooldown = await db.get<FaceCooldown>("faceCooldowns", person.id);
    if (cooldown && Date.now() - new Date(cooldown.lastCuedAt).getTime() < COOLDOWN_MS) {
      return Response.json({ status: "cooldown", personId: person.id, text: "" });
    }
    await db.set<FaceCooldown>("faceCooldowns", { id: person.id, lastCuedAt: new Date().toISOString() });

    const name = person.nickname || person.name;
    const rel = relationshipPhrase(person.relationship);
    const note = contextMode ? person.notes?.[0] : undefined;
    const fallbackCue = `${name}, ${rel}.${note ? ` ${note}` : ""}`;

    if (person.deceased) {
      return Response.json({ status: "match", personId: person.id, text: fallbackCue, distance: known.distance });
    }

    const enrolledNames = people.flatMap((p) => [p.name, p.nickname].filter((n): n is string => !!n));
    const { value } = await guarded(
      (feedback) =>
        generateJson<{ cue: string }>({
          schema: { type: "object", properties: { cue: { type: "string" } }, required: ["cue"] },
          temperature: 0.3,
          prompt: `The person is looking at someone and quietly asked who it is. Whisper a cue in their ear.
Confirmed by face matching: name "${name}", relationship "${person.relationship}".
${note ? `Optional confirmed context from the carer: "${note}"` : "No extra context."}

Write "cue": the name and relationship first, in at most ${note ? "two very short sentences (the second uses only the carer's context)" : "one very short phrase"}. Example: "${name}, ${rel}." No greeting, no question, nothing else.
${feedback ?? ""}`,
        }),
      (out) => [out.cue],
      { allowedNames: [name, person.name], enrolledNames, deceasedNames: [] },
      () => ({ cue: fallbackCue }),
    );
    return Response.json({ status: "match", personId: person.id, text: value.cue, distance: known.distance });
  } catch (e) {
    return errorResponse(e);
  }
}
