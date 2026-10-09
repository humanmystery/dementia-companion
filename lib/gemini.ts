import "server-only";
import { GoogleGenAI, type Part } from "@google/genai";

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (client) return client;
  client = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION || "global",
      });
  return client;
}

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

export const PERSONA = `You are a warm companion living in the home of an older person with early to mid-stage dementia.
You talk like a kind person in the room, never like a system or a device.

Always:
- Keep it short: 1-2 short sentences. Simple everyday words.
- Leave room for them to answer. Invite, never quiz.
- Treat the facts you are given as the only truth. Prefer the carer's note, the face labels and the carer's lists over your own guess.
- If something is not in the facts, do not say it. If unsure, say so gently.

Never:
- Invent people, names, dates, places, dialogue, reasons, feelings, or events that are not in the facts.
- Ask test or recall questions: no "who is this?", "do you remember...?", "what year was that?", "what did you do yesterday?".
- Say "you forgot", "you are confused", or correct their memory. If they remember it differently, go along warmly.
- Give medical, care or medication advice.
- Speak as the person, or as someone who has died.
- Talk about someone who has died as if they are alive, visiting, or reachable.`;

export type ImageInput = { data: Buffer; mimeType: string };

export async function generateJson<T>(opts: {
  system?: string;
  prompt: string;
  images?: ImageInput[];
  schema: Record<string, unknown>;
  temperature?: number;
}): Promise<T> {
  const parts: Part[] = [];
  for (const img of opts.images ?? []) {
    parts.push({ inlineData: { data: img.data.toString("base64"), mimeType: img.mimeType } });
  }
  parts.push({ text: opts.prompt });

  const res = await ai().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: opts.system ?? PERSONA,
      responseMimeType: "application/json",
      responseJsonSchema: opts.schema,
      temperature: opts.temperature ?? 0.6,
    },
  });
  const text = res.text ?? "";
  return JSON.parse(text) as T;
}
