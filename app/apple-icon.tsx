import { ImageResponse } from "next/og";
import { PETALS } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f8f5ef" }}>
        <svg viewBox="-12 -12 124 124" width="180" height="180">
          {PETALS.map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r="15" fill="#5f8fdc" />
          ))}
          <circle cx="50" cy="50" r="10" fill="#fffaf0" />
          <circle cx="50" cy="50" r="6" fill="#f4c44e" />
        </svg>
      </div>
    ),
    size,
  );
}
