"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";

const publicRoutes = new Set(["/", "/login", "/signup"]);

export function RootShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return publicRoutes.has(pathname) ? children : <AppShell>{children}</AppShell>;
}
