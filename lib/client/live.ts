"use client";

export type LiveTurn = { role: "companion" | "person"; text: string; interrupted?: boolean };

export type LiveEvents = {
  /** The companion's words so far in the current reply. */
  onCaption(text: string): void;
  /** The person started or kept talking. */
  onHeard(): void;
  /** A reply finished; these turns are new since the last call. */
  onTurns(turns: LiveTurn[]): void;
  /** The connection dropped without us ending it. */
  onDrop(): void;
};

export type LiveChat = {
  /** Start streaming the microphone. Call after the opener has finished playing. */
  startMic(): Promise<void>;
  /** Resolves once everything received so far has finished playing. */
  drained(): Promise<void>;
  end(reason: string, goodbye?: string): void;
};

type RelayMessage =
  | { type: "ready" }
  | { type: "audio"; data: string }
  | { type: "caption"; text: string }
  | { type: "heard" }
  | { type: "interrupted" }
  | { type: "turn_complete"; turns: LiveTurn[] }
  | { type: "error"; message: string };

const MIC_RATE = 16_000;
const PLAY_RATE = 24_000;
const CHUNK_SAMPLES = MIC_RATE / 10;

const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}

function pcm16ToFloat(b64: string): Float32Array {
  const bin = atob(b64);
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(Math.floor(bin.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Plays 24 kHz PCM chunks back to back; `stop` drops anything queued (used when they talk over it). */
function createPlayer() {
  const ctx = new AudioContext({ sampleRate: PLAY_RATE });
  const playing = new Set<AudioBufferSourceNode>();
  let nextAt = 0;
  return {
    play(b64: string) {
      if (ctx.state === "suspended") void ctx.resume();
      const samples = pcm16ToFloat(b64);
      if (!samples.length) return;
      const buf = ctx.createBuffer(1, samples.length, PLAY_RATE);
      buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      nextAt = Math.max(nextAt, ctx.currentTime + 0.05);
      src.start(nextAt);
      nextAt += buf.duration;
      playing.add(src);
      src.onended = () => playing.delete(src);
    },
    stop() {
      for (const src of playing) src.stop();
      playing.clear();
      nextAt = 0;
    },
    drained: () =>
      new Promise<void>((resolve) => {
        const check = () => (playing.size === 0 ? resolve() : setTimeout(check, 150));
        check();
      }),
    close() {
      this.stop();
      void ctx.close();
    },
  };
}

async function startMicStream(onChunk: (b64: string) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext({ sampleRate: MIC_RATE });
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(ctx, "pcm-capture");
  let pending = new Float32Array(0);
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const joined = new Float32Array(pending.length + e.data.length);
    joined.set(pending);
    joined.set(e.data, pending.length);
    pending = joined;
    while (pending.length >= CHUNK_SAMPLES) {
      onChunk(toBase64(floatToPcm16(pending.subarray(0, CHUNK_SAMPLES))));
      pending = pending.slice(CHUNK_SAMPLES);
    }
  };
  ctx.createMediaStreamSource(stream).connect(node);
  return () => {
    node.port.onmessage = null;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}

/**
 * Asks the app for a one-time ticket and connects to the Live relay. Resolves null when Live is off or can't
 * connect in time, so the caller can carry on with tap-to-talk.
 */
export async function connectLive(photoId: string, opener: string, events: LiveEvents, timeoutMs = 8000): Promise<LiveChat | null> {
  const res = await fetch("/api/live/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoId, opener }),
  });
  if (!res.ok) return null;
  const ticket = (await res.json()) as { enabled: boolean; url?: string };
  if (!ticket.enabled || !ticket.url) return null;

  const ws = new WebSocket(ticket.url);
  const player = createPlayer();
  let stopMic: (() => void) | null = null;
  let ended = false;

  const cleanup = () => {
    ended = true;
    stopMic?.();
    stopMic = null;
    player.close();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as RelayMessage;
      if (msg.type === "ready") {
        clearTimeout(timer);
        resolve(true);
      }
    };
    ws.onerror = ws.onclose = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });
  if (!ready) {
    cleanup();
    return null;
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data as string) as RelayMessage;
    if (msg.type === "audio") player.play(msg.data);
    else if (msg.type === "caption") events.onCaption(msg.text);
    else if (msg.type === "heard") events.onHeard();
    else if (msg.type === "interrupted") player.stop();
    else if (msg.type === "turn_complete") events.onTurns(msg.turns);
  };
  ws.onerror = null;
  ws.onclose = () => {
    if (ended) return;
    cleanup();
    events.onDrop();
  };

  return {
    async startMic() {
      if (ended) return;
      stopMic = await startMicStream((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio", data }));
      });
    },
    drained: () => player.drained(),
    end(reason, goodbye) {
      if (ended) return;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end", reason, goodbye }));
      cleanup();
    },
  };
}

/** The sentence being spoken now, for the on-screen caption. */
export function latestSentence(text: string): string {
  const parts = text.match(/[^.!?]+[.!?]*["')]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  return parts.at(-1) ?? text;
}
