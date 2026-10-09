import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { phrasesCrud } from "@/lib/collections";
import { draftPhrases } from "@/lib/reminders";

export const GET = () => phrasesCrud.list();

/** POST { draft: true } asks Gemini for new phrasings (unapproved); otherwise creates one from { text }. */
export async function POST(req: Request) {
  const body = (await req.clone().json().catch(() => ({}))) as { draft?: boolean };
  if (!body.draft) return phrasesCrud.create(req);
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    return Response.json(await draftPhrases());
  } catch (e) {
    return errorResponse(e);
  }
}
