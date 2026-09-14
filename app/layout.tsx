import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
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

// Renders the shared sidebar/topbar chrome for every authenticated route.
// Logged-out visitors (the /login page — middleware keeps them out of every
// other route) get bare children with no chrome. Protected pages redirect to
// /login themselves when the session is missing or invalid, so an invalid
// cookie can never render app content chromeless.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    );
  }

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
