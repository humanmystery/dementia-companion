import { pendingReminder } from "@/lib/reminders";

/** Polled by the phone and the frame as a fallback when push notifications are not set up. */
export async function GET() {
  return Response.json({ reminder: await pendingReminder() });
}
