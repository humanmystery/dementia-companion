import { errorResponse } from "@/lib/carerAuth";
import { morningRecap } from "@/lib/story";

/** POST { force?: boolean }. Without force, plays once per day and only after 7:00 on the demo clock. */
export async function POST(req: Request) {
  try {
    const { force } = (await req.json().catch(() => ({}))) as { force?: boolean };
    return Response.json(await morningRecap(!!force));
  } catch (e) {
    return errorResponse(e);
  }
}
