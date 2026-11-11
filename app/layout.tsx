import { Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { AuthHashHandler } from "@/components/auth-hash-handler";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: "RWCLL Player Evaluations",
  description: "Redwood City Little League Player Evaluation & Reporting System",
};

const geistSans = Geist({
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={geistSans.className} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased min-h-screen selection:bg-emerald-500 selection:text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthHashHandler />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}