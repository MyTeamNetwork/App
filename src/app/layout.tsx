import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ErrorBoundaryProvider } from "@/components/errors/ErrorBoundaryProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "sonner";
import { SITE_DESCRIPTION, SITE_ICON_PATHS, SITE_NAME, SITE_URL } from "@/lib/site-metadata";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  icons: {
    icon: [
      { url: SITE_ICON_PATHS.favicon, sizes: "any" },
      { url: SITE_ICON_PATHS.icon192, type: "image/png", sizes: "192x192" },
    ],
    shortcut: [SITE_ICON_PATHS.favicon],
    apple: [{ url: SITE_ICON_PATHS.appleTouch, sizes: "180x180", type: "image/png" }],
  },
  verification: {
    google: "ABHMicqF2aoLD1T2krG0zYWL9PJXgaQZkMtfxsY46ug",
  },
};

/** Lets iOS expose env(safe-area-inset-*) for notches and home indicator. */
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <ErrorBoundaryProvider>
            {children}
          </ErrorBoundaryProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
