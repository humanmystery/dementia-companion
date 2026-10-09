import { errorResponse } from "@/lib/carerAuth";
import { issueTicket } from "@/lib/live";

export async function POST(req: Request) {
  try {
    const { photoId, opener } = (await req.json()) as { photoId: string; opener: string };
    const issued = await issueTicket(photoId, String(opener ?? "").slice(0, 500));
    return Response.json(issued ? { enabled: true, url: issued.url } : { enabled: false });
  } catch (e) {
    return errorResponse(e);
  }
}
