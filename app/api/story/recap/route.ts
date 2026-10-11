import { errorResponse } from "@/lib/carerAuth";
import { morningRecap, recapStatus } from "@/lib/story";

/** Whether the morning invitation should show on the frame now. */
export async function GET() {
  try {
    return Response.json(await recapStatus());
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST { force?: boolean }. Without force, plays once per day and only after 7:00 on the demo clock. */
export async function POST(req: Request) {
  try {
    const { force } = (await req.json().catch(() => ({}))) as { force?: boolean };
    return Response.json(await morningRecap(!!force));
  } catch (e) {
    return errorResponse(e);
  }
}
