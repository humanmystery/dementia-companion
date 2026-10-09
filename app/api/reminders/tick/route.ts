import { carerDenied, errorResponse } from "@/lib/carerAuth";
import { tick } from "@/lib/reminders";

/**
 * Called by Cloud Scheduler every 15 minutes (x-cron-secret header), or by the carer page with
 * { force: true } to fire a reminder immediately for the demo.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const fromScheduler = !!secret && req.headers.get("x-cron-secret") === secret;
  if (!fromScheduler) {
    const denied = carerDenied(req);
    if (denied) return denied;
  }
  try {
    const { force } = (await req.json().catch(() => ({}))) as { force?: boolean };
    return Response.json(await tick(!fromScheduler && !!force));
  } catch (e) {
    return errorResponse(e);
  }
}
