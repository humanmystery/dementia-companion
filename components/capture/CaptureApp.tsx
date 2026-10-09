"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectFaces, loadFaceApi } from "@/lib/client/faces";
import { canvasToBlob, resizeToCanvas } from "@/lib/client/images";
import { enablePush, pushConfigured } from "@/lib/client/push";
import { speak } from "@/lib/client/voice";

type TaskResult = {
  status: string;
  text: string;
  retake?: boolean;
  autoRetake?: boolean;
  choices?: { taskId: string; label: string }[];
  seen?: string;
};

type Busy = null | "who" | "help" | "photo" | "auto";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function CaptureApp() {
  const params = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [said, setSaid] = useState("");
  const [retake, setRetake] = useState(false);
  const [choices, setChoices] = useState<TaskResult["choices"]>();
  const [invite, setInvite] = useState<{ id: string; text: string } | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [contextMode, setContextMode] = useState(false);
  const [pushState, setPushState] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const spokenInvite = useRef<string | null>(null);

  const note = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 8));

  async function start() {
    setStarted(true);
    void loadFaceApi();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("The camera isn't available. Please allow camera access and reload.");
    }
    // Unlocks audio on iOS: the first sound must follow a tap.
    void speak("I'm here.");
  }

  const say = useCallback(async (text: string) => {
    setSaid(text);
    if (text) await speak(text);
  }, []);

  async function frame(maxSide = 1280) {
    const video = videoRef.current;
    if (!video || !video.videoWidth) throw new Error("Camera not ready");
    return resizeToCanvas(video, maxSide);
  }

  // ---- Who is this? (face descriptors only leave the phone, never the image)
  async function whoIsThis() {
    setBusy("who");
    setRetake(false);
    setChoices(undefined);
    try {
      const faces = await detectFaces(await frame(960));
      const res = await fetch("/api/face/cue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faces, contextMode }),
      });
      const out = (await res.json()) as { status: string; text: string; distance?: number };
      note(`face: ${out.status}${out.distance != null ? ` (distance ${out.distance.toFixed(2)})` : ""}`);
      if (out.status === "cooldown") setSaid("(Already said just now)");
      else await say(out.text);
    } catch {
      await say("Sorry, I couldn't look just now.");
    } finally {
      setBusy(null);
    }
  }

  // ---- Help me (task support)
  async function askTask(trigger: "manual" | "auto", attempt: number, chosenTaskId?: string): Promise<TaskResult> {
    const fd = new FormData();
    fd.append("file", await canvasToBlob(await frame()), "scene.jpg");
    fd.append("trigger", trigger);
    fd.append("attempt", String(attempt));
    if (chosenTaskId) fd.append("chosenTaskId", chosenTaskId);
    const res = await fetch("/api/task/assist", { method: "POST", body: fd });
    if (!res.ok) throw new Error("failed");
    const out = (await res.json()) as TaskResult;
    note(`task ${trigger}#${attempt}: ${out.status}${out.seen ? ` (${out.seen})` : ""}`);
    return out;
  }

  async function helpMe(attempt = 0, chosenTaskId?: string) {
    setBusy("help");
    setRetake(false);
    setChoices(undefined);
    try {
      const out = await askTask("manual", attempt, chosenTaskId);
      setRetake(!!out.retake);
      setChoices(out.choices);
      await say(out.text);
    } catch {
      await say("Sorry, I couldn't check just now. Let's try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  /** Mid-stage: a movement pattern (simulated here) captures photos automatically and stays quiet when unsure. */
  async function movementTrigger() {
    setDemoOpen(false);
    setBusy("auto");
    setRetake(false);
    setChoices(undefined);
    setSaid("");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const out = await askTask("auto", attempt);
        if (out.text) {
          await say(out.text);
          break;
        }
        if (!out.autoRetake) break;
        await sleep(1500);
      }
    } catch {
      note("auto: request failed, staying quiet");
    } finally {
      setBusy(null);
    }
  }

  // ---- Take a photo (reminders, or any time)
  async function takePhoto() {
    setBusy("photo");
    try {
      const canvas = await frame(1600);
      const faces = await detectFaces(canvas).catch(() => []);
      const fd = new FormData();
      fd.append("file", await canvasToBlob(canvas), "moment.jpg");
      fd.append("source", "capture");
      fd.append("faces", JSON.stringify(faces));
      const coords = await new Promise<GeolocationCoordinates | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => resolve(null), { timeout: 3000 });
      });
      if (coords) {
        fd.append("lat", String(coords.latitude));
        fd.append("lng", String(coords.longitude));
      }
      await fetch("/api/photos", { method: "POST", body: fd });
      if (invite) {
        await fetch("/api/reminders/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: invite.id, accepted: true }),
        });
        setInvite(null);
      }
      await say("Lovely. I've kept that one.");
    } catch {
      await say("Sorry, that photo didn't save.");
    } finally {
      setBusy(null);
    }
  }

  async function declineInvite() {
    if (!invite) return;
    await fetch("/api/reminders/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invite.id, accepted: false }),
    });
    setInvite(null);
    setSaid("");
  }

  // Poll for a gentle photo invitation (works without push notifications).
  useEffect(() => {
    const check = async () => {
      const res = await fetch("/api/reminders/pending");
      const { reminder } = (await res.json()) as { reminder: { id: string; text: string } | null };
      setInvite(reminder);
    };
    void check();
    const t = setInterval(check, 20_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (started && invite && spokenInvite.current !== invite.id) {
      spokenInvite.current = invite.id;
      void say(invite.text);
    }
  }, [started, invite, say]);

  const fromNotification = params.get("mode") === "photo";

  if (!started) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#1f1915] px-8 text-center text-white">
        <h1 className="text-3xl font-bold">Your companion</h1>
        <p className="max-w-sm text-lg opacity-80">
          {fromNotification ? "Shall we take a photo?" : "This phone stands in for the glasses. Pop your earbuds in."}
        </p>
        <button onClick={start} className="rounded-full bg-accent px-10 py-5 text-2xl font-bold shadow-xl">
          Start
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      {cameraError && <div className="relative m-4 rounded-xl bg-red-900/80 p-3">{cameraError}</div>}

      {/* What was said */}
      <div className="relative mt-auto px-5 pb-4">
        {said && (
          <div className="fade-in mb-4 rounded-3xl bg-black/55 px-5 py-4 text-2xl leading-snug backdrop-blur">{said}</div>
        )}

        {invite && (
          <div className="fade-in mb-4 flex items-center gap-3 rounded-3xl bg-[#f6efe6] px-5 py-4 text-xl text-[#3b2f2a]">
            <span className="flex-1">{invite.text}</span>
            <button onClick={takePhoto} className="rounded-full bg-accent px-5 py-2 font-bold text-white">
              Yes
            </button>
            <button onClick={declineInvite} className="rounded-full bg-black/10 px-4 py-2">
              Not now
            </button>
          </div>
        )}

        {choices && (
          <div className="mb-4 flex gap-3">
            {choices.map((c) => (
              <button
                key={c.taskId}
                onClick={() => helpMe(1, c.taskId)}
                className="flex-1 rounded-2xl bg-white/90 px-4 py-4 text-lg font-semibold text-black"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {retake && (
          <button
            onClick={() => helpMe(1)}
            className="mb-4 w-full rounded-2xl bg-white/90 py-4 text-xl font-semibold text-black"
          >
            Take one more
          </button>
        )}

        <div className="grid grid-cols-3 gap-3">
          <BigButton label="Who is this?" active={busy === "who"} disabled={!!busy} onClick={whoIsThis} />
          <BigButton label="Help me" active={busy === "help" || busy === "auto"} disabled={!!busy} onClick={() => helpMe(0)} />
          <BigButton label="Take a photo" active={busy === "photo"} disabled={!!busy} onClick={takePhoto} />
        </div>
      </div>

      {/* Demo controls: stand-ins for glasses hardware */}
      <button
        onClick={() => setDemoOpen((o) => !o)}
        className="absolute right-3 top-3 rounded-full bg-black/40 px-3 py-1 text-xs opacity-70"
      >
        Demo
      </button>
      {demoOpen && (
        <div className="absolute right-3 top-12 z-10 flex w-72 flex-col gap-2 rounded-2xl bg-white/95 p-4 text-sm text-black shadow-2xl">
          <button onClick={movementTrigger} className="rounded-lg bg-accent px-3 py-2 font-semibold text-white">
            Simulate movement trigger (mid-stage)
          </button>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={contextMode} onChange={(e) => setContextMode(e.target.checked)} />
            Add a confirmed note to face cues
          </label>
          {pushConfigured() && (
            <button
              className="rounded-lg bg-black/10 px-3 py-2"
              onClick={async () => setPushState(await enablePush().catch((e) => String(e)))}
            >
              Turn on photo notifications {pushState && `(${pushState})`}
            </button>
          )}
          <div className="mt-1 max-h-40 overflow-y-auto text-xs opacity-70">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BigButton({
  label,
  onClick,
  disabled,
  active,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-3xl px-2 py-6 text-lg font-bold shadow-xl backdrop-blur transition ${
        active ? "breathe bg-accent" : "bg-white/20"
      } disabled:opacity-60`}
    >
      {label}
    </button>
  );
}
