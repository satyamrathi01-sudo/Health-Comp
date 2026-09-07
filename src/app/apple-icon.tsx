import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #141A18 0%, #080B0A 100%)",
          color: "#A3E635",
          fontSize: 104,
        }}
      >
        ⚡
      </div>
    ),
    size,
  );
}
