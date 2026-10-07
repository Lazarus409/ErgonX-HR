import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterServiceWorker from "./register-sw";

export const metadata: Metadata = { title: "ErgonX", description: "Institution operations workspace", manifest: "/manifest.webmanifest", appleWebApp: { capable: true, statusBarStyle: "default", title: "ErgonX" } };
export const viewport: Viewport = { themeColor: "#123b5d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><RegisterServiceWorker />{children}</body></html>;
}
