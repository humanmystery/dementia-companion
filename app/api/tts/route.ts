import { synthesize } from "@/lib/tts";

/** Returns MP3 audio, or 204 so the browser falls back to its built-in voice. */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response(null, { status: 400 });
  try {
    const audio = await synthesize(text.slice(0, 600));
    if (!audio) return new Response(null, { status: 204 });
    return new Response(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("TTS failed", e);
    return new Response(null, { status: 204 });
  }
}
