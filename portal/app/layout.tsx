import type { Metadata } from "next";
import { Allura, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-mono",
  display: "swap",
});

// Handwriting face used only to render typed e-signatures.
const allura = Allura({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-signature",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Rupert",
    template: "%s | Rupert",
  },
  description: "Log in to your Rupert account.",
  robots: "noindex, follow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-US">
      <body
        className={`${inter.variable} ${ibmPlexMono.variable} ${allura.variable} font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
