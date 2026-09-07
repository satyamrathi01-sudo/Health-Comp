import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FitClash",
    short_name: "FitClash",
    description: "Log food and training, get an AI breakdown, and out-score your friend every day.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#080B0A",
    theme_color: "#080B0A",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
