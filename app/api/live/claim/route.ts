import { errorResponse } from "@/lib/carerAuth";
import { claimTicket, relayDenied } from "@/lib/live";

export async function POST(req: Request) {
  const denied = relayDenied(req);
  if (denied) return denied;
  try {
    const { ticket } = (await req.json()) as { ticket: string };
    const setup = ticket ? await claimTicket(ticket) : null;
    return setup ? Response.json(setup) : Response.json({ error: "Ticket expired or already used" }, { status: 403 });
  } catch (e) {
    return errorResponse(e);
  }
}
