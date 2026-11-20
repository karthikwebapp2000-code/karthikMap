import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource-variable/inter";
import "./globals.css";
import "./design.css";
import { THEME_BOOT_SCRIPT } from "@/lib/themeBoot";
import RegisterSW from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "Karthik Map",
  description: "Work map — saved sites, railway stations, multi-stop routes and live satellite data.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b57d0",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body>{children}<RegisterSW /></body>
    </html>
  );
}
