import { errorResponse } from "@/lib/carerAuth";
import { replyAboutPhoto, type Turn } from "@/lib/story";

export async function POST(req: Request) {
  try {
    const { photoId, history, closing } = (await req.json()) as {
      photoId: string;
      history: Turn[];
      closing?: boolean;
    };
    return Response.json(await replyAboutPhoto(photoId, history.slice(-12), !!closing));
  } catch (e) {
    return errorResponse(e);
  }
}
