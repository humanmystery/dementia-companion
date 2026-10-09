import { answerReminder } from "@/lib/reminders";

export async function POST(req: Request) {
  const { id, accepted } = (await req.json()) as { id: string; accepted: boolean };
  return Response.json(await answerReminder(id, !!accepted));
}
