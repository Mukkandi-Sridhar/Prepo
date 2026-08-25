import type { Metadata } from "next";
import Link from "next/link";
import { config } from "@prepo/shared";
import { currentUser } from "@/lib/auth";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prepo — your repo, cross-examined",
  description:
    "Point it at the repo on your resume. It reads the code, builds a dossier, and cross-examines you the way a real interviewer would.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              Prepo<span>.</span>
            </Link>

            {user && (
              <nav className="nav">
                <Link href="/">Projects</Link>
                <Link href="/review">Review</Link>
                <Link href="/settings">Settings</Link>
                {!config.singleUserMode && (
                  <form action="/api/auth/signout" method="post">
                    <button className="ghost small" type="submit">
                      Sign out
                    </button>
                  </form>
                )}
              </nav>
            )}
          </div>
        </header>

        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
