"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Tổng quan", icon: <><path d="M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z" /></> },
  { href: "/map", label: "Bản đồ", icon: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" /></> },
  { href: "/parcels", label: "Thửa đất", icon: <><path d="m4 7 8-4 8 4-8 4-8-4Zm0 5 8 4 8-4m-16 5 8 4 8-4" /></> },
  { href: "/reports", label: "Báo cáo", icon: <><path d="M5 3h10l4 4v14H5V3Zm10 0v5h4M8 13h8m-8 4h8" /></> }
];

function NavIcon({ children }: { children: React.ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="workspace-shell min-h-screen">
      <aside className="workspace-sidebar fixed inset-y-0 left-0 z-30 hidden w-[220px] lg:flex lg:flex-col">
        <div className="workspace-brand flex h-20 items-center gap-3 px-6">
          <div className="brand-mark"><span /><span /><span /></div>
          <div><h1 className="text-sm font-bold tracking-tight">TerraWatch</h1><p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.14em]">Land Intelligence</p></div>
        </div>
        <div className="px-4 py-6">
          <p className="workspace-label px-3 text-xs font-bold uppercase tracking-[0.18em]">Không gian làm việc</p>
          <nav className="mt-3 space-y-1">
            {nav.map((item) => {
              const active = pathname === item.href;
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("nav-item", active && "nav-item-active")}><NavIcon>{item.icon}</NavIcon><span>{item.label}</span>{active && <i />}</Link>;
            })}
          </nav>
        </div>
        <div className="mt-auto p-4">
          <div className="workspace-status p-4">
            <div className="flex items-center gap-2 text-xs font-semibold"><span className="h-2 w-2 rounded-full" /> Hệ thống hoạt động</div>
            <p className="mt-2 text-xs leading-5">Dữ liệu cần được xác minh thực địa trước quyết định hành chính.</p>
          </div>
          <div className="mt-4 flex items-center gap-3 px-2">
            <div className="workspace-avatar grid h-9 w-9 place-items-center text-xs font-bold">BL</div>
            <div className="min-w-0"><p className="truncate text-xs font-semibold">UBND xã Bình Lợi</p><p className="workspace-role text-xs">Quản trị viên</p></div>
          </div>
        </div>
      </aside>
      <header className="workspace-mobile sticky top-0 z-30 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2"><div className="brand-mark brand-mark-sm"><span /><span /><span /></div><div className="font-semibold">TerraWatch</div></div>
        <nav className="scrollbar-none mt-3 flex gap-1 overflow-x-auto">
          {nav.map((item) => <Link className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold", pathname === item.href && "active")} href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
      </header>
      <main className="lg:pl-[220px]">{children}</main>
    </div>
  );
}
