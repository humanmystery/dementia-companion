/**
 * Gemini Live relay. Vertex AI has no short-lived browser tokens for Live, so the frame connects here instead:
 * it presents a one-time ticket from the app, this service claims it (getting the photo, facts and rules),
 * opens the Vertex Live session with its own service account, and passes audio both ways.
 */
import { createServer } from "node:http";
import { GoogleAuth } from "google-auth-library";
import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8081);
const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const RELAY_SECRET = process.env.LIVE_RELAY_SECRET || "";
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "amnet-sea";
const LOCATION = process.env.LIVE_LOCATION || "us-central1";
const MODEL = process.env.LIVE_MODEL || "gemini-3.8-live";
const VOICE = process.env.LIVE_VOICE || "Aoede";
const MAX_SESSION_MS = 8 * 60_000;
const ALLOWED_ORIGINS = new Set([new URL(APP_URL).origin, ...(process.env.EXTRA_ORIGINS?.split(",").filter(Boolean) ?? [])]);

type Setup = {
  sessionId: string;
  systemInstruction: string;
  image: { mimeType: string; data: string } | null;
  opener: string;
};
type Turn = { role: "companion" | "person"; text: string; interrupted?: boolean };
type ServerContent = {
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
  modelTurn?: { parts?: { inlineData?: { data: string; mimeType?: string } }[] };
  interrupted?: boolean;
  turnComplete?: boolean;
};
type UpstreamMessage = { setupComplete?: unknown; serverContent?: ServerContent };
type ClientMessage = { type: "audio"; data: string } | { type: "end"; reason?: string; goodbye?: string };

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function appPost<T>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-relay-secret": RELAY_SECRET },
    body: JSON.stringify(body),
  });
  return res.ok ? ((await res.json()) as T) : null;
}

function setupMessage(setup: Setup) {
  return {
    setup: {
      model: `projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        temperature: 0.6,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      },
      systemInstruction: { parts: [{ text: setup.systemInstruction }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Older speakers pause mid-sentence; wait a little longer before deciding they've finished.
      realtimeInputConfig: {
        automaticActivityDetection: { endOfSpeechSensitivity: "END_SENSITIVITY_LOW", silenceDurationMs: 1200 },
        activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
      },
      historyConfig: { initialHistoryInClientContent: true },
    },
  };
}

/** The photo and the opener already spoken, as history that does not trigger a reply. */
function historyMessage(setup: Setup) {
  const parts: Record<string, unknown>[] = [{ text: "(We are looking at this photo together on the frame.)" }];
  if (setup.image) parts.unshift({ inlineData: setup.image });
  return {
    clientContent: {
      turns: [
        { role: "user", parts },
        { role: "model", parts: [{ text: setup.opener }] },
      ],
      turnComplete: true,
    },
  };
}

function bridge(client: WebSocket, setup: Setup) {
  const turns: Turn[] = [{ role: "companion", text: setup.opener }];
  let sentTurns = turns.length;
  let heard = "";
  let said = "";
  let ready = false;
  let finished = false;
  let upstream: WebSocket | null = null;
  const tag = setup.sessionId.slice(0, 8);

  const send = (msg: Record<string, unknown>) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  };
  const pushHeard = () => {
    if (heard.trim()) turns.push({ role: "person", text: heard.trim() });
    heard = "";
  };
  const pushSaid = (interrupted = false) => {
    if (said.trim()) turns.push({ role: "companion", text: said.trim(), ...(interrupted ? { interrupted } : {}) });
    said = "";
  };

  const finish = (reason: string, goodbye?: string) => {
    if (finished) return;
    finished = true;
    clearTimeout(cap);
    pushHeard();
    pushSaid();
    if (goodbye) turns.push({ role: "companion", text: goodbye });
    upstream?.close();
    if (client.readyState === WebSocket.OPEN) client.close(1000, reason.slice(0, 100));
    console.log(`[${tag}] ended: ${reason}, ${turns.length} turns`);
    appPost("/api/live/transcript", { sessionId: setup.sessionId, turns, endedReason: reason }).catch((e) =>
      console.error(`[${tag}] transcript save failed`, e),
    );
  };
  const cap = setTimeout(() => finish("time_limit"), MAX_SESSION_MS);

  const onUpstream = (m: UpstreamMessage) => {
    if (m.setupComplete) {
      upstream?.send(JSON.stringify(historyMessage(setup)));
      ready = true;
      send({ type: "ready" });
      return;
    }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) {
      heard += sc.inputTranscription.text;
      send({ type: "heard" });
    }
    if (sc.outputTranscription?.text) {
      pushHeard();
      said += sc.outputTranscription.text;
      send({ type: "caption", text: said.trim() });
    }
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) send({ type: "audio", data: part.inlineData.data });
    }
    if (sc.interrupted) {
      pushSaid(true);
      send({ type: "interrupted" });
    }
    if (sc.turnComplete) {
      pushHeard();
      pushSaid();
      send({ type: "turn_complete", turns: turns.slice(sentTurns) });
      sentTurns = turns.length;
    }
  };

  client.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "end") finish(msg.reason || "ended", msg.goodbye);
    else if (msg.type === "audio" && ready && upstream?.readyState === WebSocket.OPEN) {
      upstream.send(JSON.stringify({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: msg.data } } }));
    }
  });
  client.on("close", () => finish("frame_closed"));
  if (client.readyState !== WebSocket.OPEN) return finish("frame_closed");

  (async () => {
    const token = await auth.getAccessToken();
    if (finished) return;
    const host = LOCATION === "global" ? "aiplatform.googleapis.com" : `${LOCATION}-aiplatform.googleapis.com`;
    const ws = new WebSocket(`wss://${host}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    upstream = ws;
    ws.on("open", () => ws.send(JSON.stringify(setupMessage(setup))));
    ws.on("message", (raw) => {
      try {
        onUpstream(JSON.parse(raw.toString()) as UpstreamMessage);
      } catch (e) {
        console.error(`[${tag}] bad upstream message`, e);
      }
    });
    ws.on("close", (code, reason) => {
      if (finished) return;
      console.warn(`[${tag}] Live closed ${code} ${reason.toString().slice(0, 200)}`);
      send({ type: "error", message: "Live session closed" });
      finish("live_dropped");
    });
    ws.on("error", (e) => console.error(`[${tag}] Live error`, e.message));
  })().catch((e) => {
    console.error(`[${tag}] connect failed`, e);
    send({ type: "error", message: "Could not reach Gemini Live" });
    finish("connect_failed");
  });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});

server.on("upgrade", async (req, socket, head) => {
  const reject = (status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (!ALLOWED_ORIGINS.has(req.headers.origin ?? "")) return reject("403 Forbidden");
  const ticket = new URL(req.url ?? "/", "http://relay").searchParams.get("ticket");
  if (!ticket) return reject("401 Unauthorized");
  const setup = await appPost<Setup>("/api/live/claim", { ticket }).catch((e) => {
    console.error("claim failed", e);
    return null;
  });
  if (!setup) return reject("401 Unauthorized");
  wss.handleUpgrade(req, socket, head, (client) => bridge(client, setup));
});

if (!RELAY_SECRET) console.warn("LIVE_RELAY_SECRET is not set; the app will refuse every ticket claim.");
server.listen(PORT, () => console.log(`Live relay on :${PORT} -> ${APP_URL} (${MODEL} in ${LOCATION})`));
