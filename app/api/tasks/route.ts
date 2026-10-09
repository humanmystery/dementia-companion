import { tasksCrud } from "@/lib/collections";

export const GET = () => tasksCrud.list();
export const POST = (req: Request) => tasksCrud.create(req);
