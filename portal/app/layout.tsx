import type { Metadata } from "next";
import { Allura, IBM_Plex_Mono } from "next/font/google";
import "@fontsource/inter/latin-300.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "./globals.css";

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
    <html
      lang="en-US"
      className={`${ibmPlexMono.variable} ${allura.variable} font-sans`}
    >
      <body>
        {children}
      </body>
    </html>
  );
}
