import { errorResponse } from "@/lib/carerAuth";
import { relayDenied, saveTranscript } from "@/lib/live";
import type { LiveTurn } from "@/lib/types";

export async function POST(req: Request) {
  const denied = relayDenied(req);
  if (denied) return denied;
  try {
    const { sessionId, turns, endedReason } = (await req.json()) as {
      sessionId: string;
      turns: LiveTurn[];
      endedReason: string;
    };
    await saveTranscript(sessionId, turns.slice(0, 200), String(endedReason ?? "ended"));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
