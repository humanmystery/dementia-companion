import "server-only";

type TtsClient = import("@google-cloud/text-to-speech").TextToSpeechClient;
let client: TtsClient | null = null;

export async function synthesize(text: string): Promise<Buffer | null> {
  if (process.env.TTS_DISABLED === "1") return null;
  if (!client) {
    const { TextToSpeechClient } = await import("@google-cloud/text-to-speech");
    client = new TextToSpeechClient({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  const [res] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: process.env.TTS_LANGUAGE || "en-GB",
      name: process.env.TTS_VOICE || "en-GB-Chirp3-HD-Aoede",
    },
    audioConfig: { audioEncoding: "MP3", speakingRate: 0.92 },
  });
  return res.audioContent ? Buffer.from(res.audioContent as Uint8Array) : null;
}
