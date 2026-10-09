import { errorResponse } from "@/lib/carerAuth";
import { openPhoto } from "@/lib/story";

export async function POST(req: Request) {
  try {
    const { photoId } = (await req.json()) as { photoId: string };
    return Response.json(await openPhoto(photoId));
  } catch (e) {
    return errorResponse(e);
  }
}
