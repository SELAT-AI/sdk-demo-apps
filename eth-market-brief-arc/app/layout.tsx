import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ETH Market Brief (Arc) | SELAT SDK Demo",
    template: "%s | SELAT"
  },
  description:
    "A SELAT Router SDK demo that builds an ETH market brief across x402 and MPP paid API rails, funded from a Circle Gateway balance on Arc and signed with a private key.",
  openGraph: {
    title: "ETH Market Brief",
    description:
      "A treasury analyst workflow powered by SELAT paid API routing across x402 and MPP.",
    type: "website"
  },
  icons: {
    icon: "/selat-favicon-mark.svg",
    shortcut: "/selat-favicon-mark.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
