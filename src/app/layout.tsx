import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AuthProvider } from "@/lib/client/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Golden Point — weekly padel",
  description:
    "Your weekly padel group: who’s in, who’s paid and who’s waiting.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#075985",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-ZA" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <div className="site-content">
          <header className="topbar">
            <Link href="/" className="brand-lockup"><span className="brand-ball" aria-hidden="true" />Golden Point<span className="brand-period">.</span></Link>
            <nav>
              <Link href="/tournament/new">Americano / Mexicano</Link>
              <Link href="/match">Match us up</Link>
              <Link href="/me">My bookings</Link>
              <Link href="/admin">Organise</Link>
            </nav>
          </header>
          {children}
          <footer className="site-footer">
            <a href="https://github.com/MarkGrenville/golden-point">
              Free and open source
            </a>{" "}
            · Powered by <a href="https://webfootprint.co.za">Web Footprint</a>{" "}
            ·{" "}
            <a href="https://webfootprint.co.za">
              Need an app or a change? Get in touch
            </a>
          </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
