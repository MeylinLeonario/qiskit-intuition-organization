import type { Metadata } from "next";
import "./globals.css";
import "./notebook.css";
import "./auth.css";
import { AuthProvider } from "@/components/auth-provider";

export const metadata: Metadata = {
  title: "Qiskit Intuition — Learn quantum computing",
  description:
    "A focused quantum computing course with an interactive circuit simulator and context-aware Qiskit code coach.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
