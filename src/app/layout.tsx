import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FitClash",
  description: "Log food and training, get an AI breakdown, and out-score your friend every day.",
  applicationName: "FitClash",
  appleWebApp: {
    capable: true,
    title: "FitClash",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#080B0A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

/**
 * Chrome, Edge and Samsung Internet fire beforeinstallprompt once, early, and
 * only to listeners that already exist. React has not loaded by then, so this
 * catches it while the HTML is still parsing and parks it on window for
 * InstallPrompt to replay when someone taps "Add to home screen".
 * preventDefault() stops the browser's own mini-infobar competing with ours.
 */
const CAPTURE_INSTALL_PROMPT =
  'window.addEventListener("beforeinstallprompt",function(e){' +
  "e.preventDefault();window.__fitclashInstall=e;" +
  'window.dispatchEvent(new Event("fitclash:installable"));});' +
  'window.addEventListener("appinstalled",function(){window.__fitclashInstall=null;});';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <InlineScript html={CAPTURE_INSTALL_PROMPT} />
        {children}
      </body>
    </html>
  );
}

/**
 * A script that runs during HTML parsing, before hydration. The type swap is
 * the pattern from Next's guide on preventing a flash before hydration: it
 * stops React warning about a <script> in the tree without changing what the
 * browser runs.
 */
function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
