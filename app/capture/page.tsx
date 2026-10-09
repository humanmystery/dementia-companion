import { Suspense } from "react";
import CaptureApp from "@/components/capture/CaptureApp";

export const metadata = { title: "Glasses · Companion" };

export default function CapturePage() {
  return (
    <Suspense>
      <CaptureApp />
    </Suspense>
  );
}
