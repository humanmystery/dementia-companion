import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { resetAll, seedDemo } from "@/lib/seed";

/** POST { reset?: boolean } loads the demo profile, tasks, schedule and reminder phrasings. */
export async function POST(req: Request) {
  const denied = carerDenied(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { reset?: boolean; seed?: boolean };
    if (body.reset) await resetAll();
    if (body.seed !== false) await seedDemo();
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
