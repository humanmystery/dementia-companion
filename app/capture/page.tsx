import { Suspense } from "react";
import CaptureApp from "@/components/capture/CaptureApp";

export const metadata = { title: "Glasses · Forget Me Not" };

export default function CapturePage() {
  return (
    <Suspense>
      <CaptureApp />
    </Suspense>
  );
}
