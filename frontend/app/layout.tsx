import type { Metadata } from "next";
import "./globals.css";
import { RootShell } from "@/components/root-shell";

export const metadata: Metadata = {
  title: "TerraWatch — AI-assisted change monitoring",
  description: "Explainable geospatial change monitoring for local teams."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
