import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { markTalkedAbout } from "./dayPhotos";
import { db } from "./db";
import { flagLiveTurns, liveSetup, type LiveSetup } from "./story";
import type { LiveSession, LiveTurn } from "./types";

const TICKET_TTL_MS = 2 * 60_000;

const hashTicket = (ticket: string) => createHash("sha256").update(ticket).digest("hex").slice(0, 32);

/** Live is on only when the relay is configured. Without it the frame keeps the tap-to-talk chat. */
export function liveRelayUrl(): string | null {
  const url = process.env.LIVE_RELAY_URL;
  return url && url !== "unset" && process.env.LIVE_RELAY_SECRET ? url : null;
}

/** Only the relay may claim tickets and save transcripts. */
export function relayDenied(req: Request): Response | null {
  const expected = process.env.LIVE_RELAY_SECRET ?? "";
  const got = req.headers.get("x-relay-secret") ?? "";
  const ok = expected.length > 0 && got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  return ok ? null : Response.json({ error: "Relay only" }, { status: 401 });
}

/** A one-time ticket the frame hands to the relay. It carries no key and expires in two minutes. */
export async function issueTicket(photoId: string, opener: string): Promise<{ url: string } | null> {
  const relay = liveRelayUrl();
  if (!relay) return null;
  if (!(await db.get("photos", photoId))) throw new Error("Photo not found");
  const ticket = randomBytes(24).toString("base64url");
  const created = Date.now();
  await db.set<LiveSession>("liveSessions", {
    id: hashTicket(ticket),
    photoId,
    opener,
    status: "issued",
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(created + TICKET_TTL_MS).toISOString(),
    turns: [],
  });
  return { url: `${relay}${relay.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}` };
}

export async function claimTicket(ticket: string): Promise<(LiveSetup & { sessionId: string }) | null> {
  const id = hashTicket(ticket);
  const session = await db.get<LiveSession>("liveSessions", id);
  if (!session || session.status !== "issued" || Date.parse(session.expiresAt) < Date.now()) return null;
  await db.update<LiveSession>("liveSessions", id, { status: "active", startedAt: new Date().toISOString() });
  return { sessionId: id, ...(await liveSetup(session.photoId, session.opener)) };
}

export async function saveTranscript(sessionId: string, turns: LiveTurn[], endedReason: string) {
  const session = await db.get<LiveSession>("liveSessions", sessionId);
  if (!session) throw new Error("Session not found");
  const checked = await flagLiveTurns(session.photoId, turns.filter((t) => t.text.trim()));
  if (checked.some((t) => t.role === "person")) await markTalkedAbout(session.photoId);
  await db.update<LiveSession>("liveSessions", sessionId, {
    status: "ended",
    endedAt: new Date().toISOString(),
    endedReason,
    turns: checked,
    flagged: checked.some((t) => t.flags?.length),
  });
}
