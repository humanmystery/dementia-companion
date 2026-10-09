import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { db } from "@/lib/db";
import type { LiveSession } from "@/lib/types";

/** Live chat transcripts for the carer to review, newest first. Tickets that were never used are left out. */
export async function GET(req: Request) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const sessions = (await db.list<LiveSession>("liveSessions"))
      .filter((s) => s.status !== "issued")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((s) => ({ ...s, photoUrl: `/api/photos/${s.photoId}/image` }));
    return Response.json(sessions);
  } catch (e) {
    return errorResponse(e);
  }
}
