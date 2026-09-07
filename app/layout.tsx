import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/current-user";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Runloop | Personal training intelligence",
  description: "A calmer way to build durable running consistency.",
  icons: {
    icon: "/Runloop%20Logo.png",
  },
};

// Renders the shared sidebar/topbar chrome for every route in the app.
// Reads live DB state (current user, today's check-in — used for the nav
// reminder dot), so the whole app must not be statically prerendered.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getOrCreateCurrentUser();

  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const todaysCheckin = await prisma.dailyCheckin.findUnique({
    where: { userId_date: { userId: user.id, date: today } },
  });

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <main className="app-shell">
          <Sidebar user={user} showCheckInReminder={!todaysCheckin} />
          <section className="content">
            <Topbar user={user} />
            {children}
          </section>
        </main>
      </body>
    </html>
  );
}
