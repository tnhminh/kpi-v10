import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KPI Performance Management Studio",
  description: "Configurable, explainable performance management platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
