"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoView } from "@/lib/photoView";
import { useBrowserValue, useOnMount } from "@/lib/client/hooks";
import { connectLive, latestSentence, type LiveChat } from "@/lib/client/live";
import { canListen, listenOnce, speak, stopSpeaking } from "@/lib/client/voice";

type Turn = { role: "companion" | "person"; text: string; interrupted?: boolean };

type Recap =
  | { status: "too_early" | "already" }
  | { status: "empty"; lines: string[] }
  | { status: "recap"; photos: PhotoView[]; lines: string[]; summary: string; opener: string; focusPhotoId: string };

type Mode =
  | { kind: "idle" }
  /** `active` is the photo being told; -1 shows the whole day together for the wrap-up line. */
  | { kind: "recap"; photos: PhotoView[]; lines: string[]; active: number; caption: string }
  | { kind: "browse"; caption: string }
  | { kind: "chat"; photo: PhotoView; turns: Turn[]; thinking: boolean; listening: boolean; live: boolean; caption?: string };

const SLIDE_MS = 9000;
const MAX_PERSON_TURNS = 5;
const SILENCE_MS = 30_000;
const INVITE_VISIBLE_MS = 3 * 60_000;
const GOODBYE = "I'll let you rest now. Thank you for looking with me.";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export default function FrameApp() {
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [slide, setSlide] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [invite, setInvite] = useState<{ id: string; text: string } | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const cornerTaps = useRef<number[]>([]);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  const modeRef = useRef(mode);
  const liveRef = useRef<LiveChat | null>(null);
  const [lastEngine, setLastEngine] = useState("");
  const voiceInput = useBrowserValue(canListen, false);
  const liveAllowed = useBrowserValue(() => new URLSearchParams(location.search).get("live") !== "off", true);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const loadPhotos = useCallback(async () => {
    const res = await fetch("/api/photos");
    const all = (await res.json()) as PhotoView[];
    const album = all.filter((p) => p.source === "album");
    setPhotos(album.length ? album : all);
  }, []);

  useOnMount(loadPhotos);
  useEffect(() => {
    const t = setInterval(loadPhotos, 5 * 60_000);
    return () => clearInterval(t);
  }, [loadPhotos]);

  // Slideshow
  useEffect(() => {
    if (mode.kind !== "idle" || photos.length < 2) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % photos.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [mode.kind, photos.length]);

  // Gentle photo invitation (shown on the frame too). It fades by itself; nobody has to dismiss it.
  const fadedInvite = useRef<string | null>(null);
  useEffect(() => {
    const check = async () => {
      const res = await fetch("/api/reminders/pending");
      const { reminder } = (await res.json()) as { reminder: { id: string; text: string } | null };
      setInvite(reminder && reminder.id !== fadedInvite.current ? reminder : null);
    };
    const first = setTimeout(check, 0);
    const t = setInterval(check, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (!invite) return;
    const t = setTimeout(() => {
      fadedInvite.current = invite.id;
      setInvite(null);
    }, INVITE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [invite]);

  const clearSilence = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  };

  const backToSlideshow = useCallback(() => {
    clearSilence();
    stopListening.current?.();
    liveRef.current?.end("left");
    liveRef.current = null;
    stopSpeaking();
    setMode({ kind: "idle" });
  }, []);

  /** Ends any chat the same way: the goodbye in the usual voice, then back to the slideshow. */
  const endChat = useCallback(
    async (line = GOODBYE, reason = "done") => {
      clearSilence();
      const live = liveRef.current;
      liveRef.current = null;
      if (live) {
        if (reason === "turns") await live.drained();
        live.end(reason, line);
      }
      setMode((m) =>
        m.kind === "chat"
          ? { ...m, turns: [...m.turns, { role: "companion", text: line }], thinking: false, listening: false, caption: undefined }
          : m,
      );
      await speak(line);
      backToSlideshow();
    },
    [backToSlideshow],
  );

  const armLiveSilence = useCallback(() => {
    clearSilence();
    silenceTimer.current = setTimeout(() => {
      if (liveRef.current) void endChat(GOODBYE, "silence");
    }, SILENCE_MS);
  }, [endChat]);

  const armSilence = useCallback(() => {
    clearSilence();
    silenceTimer.current = setTimeout(() => {
      if (modeRef.current.kind === "chat" && !modeRef.current.listening && !modeRef.current.thinking) void endChat();
    }, SILENCE_MS);
  }, [endChat]);

  const listenRef = useRef<(() => Promise<void>) | null>(null);

  /** Speak, then hand the turn over: listen hands-free where the browser can, otherwise wait for a tap. */
  const companionSays = useCallback(
    async (text: string) => {
      setMode((m) => (m.kind === "chat" ? { ...m, turns: [...m.turns, { role: "companion", text }], thinking: false } : m));
      await speak(text);
      if (canListen() && listenRef.current) void listenRef.current();
      else armSilence();
    },
    [armSilence],
  );

  /** Tap-to-talk takes over when Live is off, fails to connect, or drops mid-chat. */
  const continueWithoutLive = useCallback(() => {
    setLastEngine("tap-to-talk");
    if (canListen() && listenRef.current) void listenRef.current();
    else armSilence();
  }, [armSilence]);

  const liveEvents = useCallback(
    (photoId: string) => ({
      onCaption: (text: string) => {
        clearSilence();
        setMode((m) => (m.kind === "chat" && m.photo.id === photoId ? { ...m, caption: latestSentence(text) } : m));
      },
      onHeard: clearSilence,
      onTurns: (turns: Turn[]) => {
        const m = modeRef.current;
        if (m.kind !== "chat" || m.photo.id !== photoId) return;
        const next = { ...m, turns: [...m.turns, ...turns] };
        modeRef.current = next;
        setMode(next);
        if (next.turns.filter((t) => t.role === "person").length >= MAX_PERSON_TURNS) void endChat(GOODBYE, "turns");
        else void liveRef.current?.drained().then(() => liveRef.current && armLiveSilence());
      },
      onDrop: () => {
        liveRef.current = null;
        const m = modeRef.current;
        if (m.kind !== "chat" || m.photo.id !== photoId) return;
        setMode({ ...m, live: false, caption: undefined });
        continueWithoutLive();
      },
    }),
    [armLiveSilence, continueWithoutLive, endChat],
  );

  const startChat = useCallback(
    async (photo: PhotoView, opener?: string) => {
      clearSilence();
      setMode({ kind: "chat", photo, turns: [], thinking: !opener, listening: false, live: false });
      let text = opener;
      if (!text) {
        try {
          text = (await post<{ opener: string }>("/api/story/open", { photoId: photo.id })).opener;
        } catch {
          text = "What a lovely photo. I'm happy to just look at it with you.";
        }
      }
      // The opener stays guard-checked and in the usual voice; Live connects while it plays.
      const live = liveAllowed ? connectLive(photo.id, text, liveEvents(photo.id)).catch(() => null) : Promise.resolve(null);
      setMode((m) => (m.kind === "chat" ? { ...m, turns: [{ role: "companion", text }], thinking: false } : m));
      await speak(text);
      const chat = await live;
      const m = modeRef.current;
      if (m.kind !== "chat" || m.photo.id !== photo.id) {
        chat?.end("left");
        return;
      }
      if (!chat) return continueWithoutLive();
      liveRef.current = chat;
      setMode({ ...m, live: true });
      setLastEngine("Gemini Live");
      try {
        await chat.startMic();
        armLiveSilence();
      } catch {
        chat.end("mic_failed");
        liveRef.current = null;
        setMode({ ...m, live: false });
        continueWithoutLive();
      }
    },
    [armLiveSilence, continueWithoutLive, liveAllowed, liveEvents],
  );

  const personSays = useCallback(
    async (text: string) => {
      const m = modeRef.current;
      if (m.kind !== "chat") return;
      if (!text.trim()) {
        await endChat();
        return;
      }
      const turns: Turn[] = [...m.turns, { role: "person", text }];
      const personTurns = turns.filter((t) => t.role === "person").length;
      const closing = personTurns >= MAX_PERSON_TURNS;
      setMode({ ...m, turns, thinking: true, listening: false });
      try {
        const { reply } = await post<{ reply: string }>("/api/story/reply", { photoId: m.photo.id, history: turns, closing });
        if (closing) await endChat(reply);
        else await companionSays(reply);
      } catch {
        await companionSays("Sorry, I didn't quite catch that. It's a lovely photo though.");
      }
    },
    [companionSays, endChat],
  );

  const listen = useCallback(async () => {
    const m = modeRef.current;
    if (m.kind !== "chat" || m.thinking || m.listening) return;
    clearSilence();
    stopSpeaking();
    const listening = { ...m, listening: true };
    modeRef.current = listening;
    setMode(listening);
    const l = listenOnce(SILENCE_MS);
    stopListening.current = l.stop;
    const text = await l.result;
    stopListening.current = null;
    if (modeRef.current.kind !== "chat") return;
    await personSays(text);
  }, [personSays]);

  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  async function playRecap(recap: Extract<Recap, { status: "recap" }>) {
    for (let i = 0; i < recap.lines.length; i++) {
      setMode({ kind: "recap", photos: recap.photos, lines: recap.lines, active: i, caption: recap.lines[i] });
      await speak(recap.lines[i]);
    }
    if (recap.summary) {
      setMode({ kind: "recap", photos: recap.photos, lines: recap.lines, active: -1, caption: recap.summary });
      await speak(recap.summary);
    }
    const focus = recap.photos.find((p) => p.id === recap.focusPhotoId) ?? recap.photos.at(-1)!;
    await startChat(focus, recap.opener);
  }

  /** First touch of the day after 7:00 plays yesterday's recap; otherwise a tap opens a chat about the photo. */
  async function onTapSlideshow() {
    const current = photos[slide];
    setMode({ kind: "recap", photos: [], lines: [], active: 0, caption: "" });
    let recap: Recap = { status: "already" };
    try {
      recap = await post<Recap>("/api/story/recap", { force: false });
    } catch {
      // fall through to a normal chat
    }
    await handleRecap(recap, current);
  }

  async function handleRecap(recap: Recap, fallbackPhoto?: PhotoView) {
    if (recap.status === "recap") return playRecap(recap);
    if (recap.status === "empty") {
      setMode({ kind: "browse", caption: recap.lines[0] });
      await speak(recap.lines[0]);
      return;
    }
    if (fallbackPhoto) return startChat(fallbackPhoto);
    setMode({ kind: "idle" });
  }

  function onCorner() {
    const now = Date.now();
    cornerTaps.current = [...cornerTaps.current.filter((t) => now - t < 1500), now];
    if (cornerTaps.current.length >= 3) {
      cornerTaps.current = [];
      setDemoOpen((o) => !o);
    }
  }

  const current = photos[slide];

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#1f1915] text-white">
      {/* Slideshow */}
      {mode.kind === "idle" && current && (
        <button className="absolute inset-0 block h-full w-full" onClick={onTapSlideshow} aria-label="Talk about this photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={current.id} src={current.url} alt="" className="fade-in ken-burns h-full w-full object-contain" />
        </button>
      )}
      {mode.kind === "idle" && !current && (
        <div className="flex h-full items-center justify-center px-10 text-center text-2xl opacity-70">
          Photos will appear here once the family adds them.
        </div>
      )}

      {/* Morning recap */}
      {mode.kind === "recap" && (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-8 py-8">
          {mode.photos.length === 0 ? (
            <div className="breathe h-6 w-6 rounded-full bg-accent-soft" />
          ) : mode.active >= 0 ? (
            <>
              <div className="relative min-h-0 w-full flex-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={mode.photos[mode.active].id}
                  src={mode.photos[mode.active].url}
                  alt=""
                  className="fade-in ken-burns absolute inset-0 h-full w-full rounded-3xl object-contain"
                />
              </div>
              <div className="flex gap-2">
                {mode.photos.map((p, i) => (
                  <span key={p.id} className={`h-2 w-2 rounded-full transition ${i === mode.active ? "bg-accent-soft" : "bg-white/25"}`} />
                ))}
              </div>
              <Caption text={mode.caption} />
            </>
          ) : (
            <>
              <div className="grid w-full max-w-6xl grid-cols-3 gap-4">
                {mode.photos.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.id} src={p.url} alt="" className="fade-in aspect-[4/3] w-full rounded-2xl object-cover shadow-xl" />
                ))}
              </div>
              <Caption text={mode.caption} />
            </>
          )}
        </div>
      )}

      {/* After an empty day: pick an old photo */}
      {mode.kind === "browse" && (
        <div className="flex h-full flex-col gap-6 overflow-y-auto p-8">
          <Caption text={mode.caption} />
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3">
            {photos.map((p) => (
              <button key={p.id} onClick={() => startChat(p)} className="overflow-hidden rounded-3xl shadow-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="aspect-[4/3] w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Conversation about one photo */}
      {mode.kind === "chat" && (
        <div className="flex h-full flex-col">
          <div className="relative min-h-0 flex-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mode.photo.url} alt="" className="fade-in h-full w-full object-contain" />
          </div>
          <div className="flex items-center gap-6 bg-gradient-to-t from-black/80 to-black/40 px-8 py-6">
            <div className="min-h-[4.5rem] flex-1 text-2xl leading-snug md:text-3xl">
              {mode.thinking ? (
                <div className="breathe h-5 w-5 rounded-full bg-accent-soft" />
              ) : (
                (mode.live && mode.caption) || [...mode.turns].reverse().find((t) => t.role === "companion")?.text
              )}
            </div>
            {mode.live ? (
              <div className="breathe h-6 w-6 shrink-0 rounded-full bg-sage" aria-label="Listening" />
            ) : voiceInput ? (
              <button
                onClick={listen}
                disabled={mode.thinking}
                className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-full text-lg font-bold shadow-xl transition ${
                  mode.listening ? "breathe bg-sage" : "bg-accent"
                } disabled:opacity-40`}
              >
                {mode.listening ? "Listening" : "Talk"}
              </button>
            ) : (
              <form
                className="flex shrink-0 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = typed;
                  setTyped("");
                  clearSilence();
                  void personSays(t);
                }}
              >
                <input
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    clearSilence();
                  }}
                  className="w-64 rounded-2xl bg-white/90 px-4 py-3 text-lg text-black"
                  placeholder="Say something..."
                />
                <button className="rounded-2xl bg-accent px-5 text-lg font-bold">Send</button>
              </form>
            )}
            <button onClick={() => void endChat()} className="shrink-0 rounded-full bg-white/15 px-5 py-3 text-lg">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Gentle photo invitation */}
      {invite && mode.kind === "idle" && (
        <div className="fade-in absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-full bg-[#f6efe6]/95 px-7 py-4 text-xl text-[#3b2f2a] shadow-2xl">
          <span>{invite.text}</span>
          <button
            className="rounded-full bg-black/10 px-4 py-1 text-base"
            onClick={async () => {
              await post("/api/reminders/answer", { id: invite.id, accepted: false });
              setInvite(null);
            }}
          >
            Not now
          </button>
        </div>
      )}

      {/* Hidden demo corner: triple-tap top-left */}
      <button className="absolute left-0 top-0 h-16 w-16 opacity-0" onClick={onCorner} aria-label="Demo controls" />
      {demoOpen && (
        <div className="absolute left-4 top-4 z-10 flex flex-col gap-2 rounded-2xl bg-white/95 p-4 text-sm text-black shadow-2xl">
          <strong>Demo</strong>
          <span className="opacity-60">
            Chat: {liveAllowed ? "Gemini Live, tap-to-talk if it fails" : "tap-to-talk (?live=off)"}
            {lastEngine && <> · last used {lastEngine}</>}
          </span>
          <button
            className="rounded-lg bg-accent px-3 py-2 font-semibold text-white"
            onClick={async () => {
              setDemoOpen(false);
              setMode({ kind: "recap", photos: [], lines: [], active: 0, caption: "" });
              await handleRecap(await post<Recap>("/api/story/recap", { force: true }));
            }}
          >
            Play morning recap now
          </button>
          <button className="rounded-lg bg-black/10 px-3 py-2" onClick={() => void loadPhotos()}>
            Reload photos
          </button>
          <button className="rounded-lg bg-black/10 px-3 py-2" onClick={backToSlideshow}>
            Back to slideshow
          </button>
          <a className="rounded-lg bg-black/10 px-3 py-2 text-center" href="/carer" target="_blank">
            Carer page
          </a>
        </div>
      )}
    </div>
  );
}

function Caption({ text }: { text: string }) {
  if (!text) return null;
  return <p className="fade-in max-w-4xl text-center text-3xl leading-snug md:text-4xl">{text}</p>;
}
