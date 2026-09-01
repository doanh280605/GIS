import Link from "next/link";
import { Card } from "@/components/ui/card";
import { API_URL } from "@/lib/api";

type Stats = {
  totalParcels: number;
  detectedChanges: number;
  pendingInspections: number;
  resolvedCases: number;
  monthlyTrend: Record<string, number>;
};

async function getStats(): Promise<Stats> {
  const res = await fetch(`${API_URL}/api/dashboard/stats`, { cache: "no-store" });
  if (!res.ok) return { totalParcels: 0, detectedChanges: 0, pendingInspections: 0, resolvedCases: 0, monthlyTrend: {} };
  return res.json();
}

const icons = {
  parcels: <path d="m3 6 9-3 9 3-9 3-9-3Zm0 6 9 3 9-3M3 9v9l9 3 9-3V9M12 9v12" />,
  changes: <path d="M12 3v3m0 12v3M3 12h3m12 0h3m-3.6-5.4-2.1 2.1M8.7 15.3l-2.1 2.1m0-10.8 2.1 2.1m6.6 6.6 2.1 2.1M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" />,
  pending: <path d="M12 8v5l3 2M5.6 5.6A9 9 0 1 0 12 3M3 3v5h5" />,
  resolved: <path d="m5 12 4 4L19 6" />
};

export default async function Dashboard() {
  const stats = await getStats();
  const trend = Object.entries(stats.monthlyTrend);
  const max = Math.max(1, ...trend.map(([, value]) => value));
  const totalCases = stats.pendingInspections + stats.resolvedCases;
  const resolutionRate = totalCases ? Math.round((stats.resolvedCases / totalCases) * 100) : 0;
  const changeRate = stats.totalParcels ? ((stats.detectedChanges / stats.totalParcels) * 100).toFixed(1) : "0";
  const peak = trend.reduce<[string, number]>((best, item) => item[1] > best[1] ? item : best, ["—", 0]);
  const latest = trend.at(-1)?.[1] ?? 0;
  const previous = trend.at(-2)?.[1] ?? 0;
  const delta = previous ? Math.round(((latest - previous) / previous) * 100) : 0;

  return (
    <div className="dashboard-bg min-h-screen px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
            <span className="status-pulse" /> Trung tâm điều hành địa chính
          </div>
          <h2 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">Tổng quan Bình Lợi</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Theo dõi biến động địa chính và tiến độ xác minh trên toàn xã.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="date-chip">
            <Icon><path d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" /></Icon>
            Dữ liệu hiện tại
          </div>
          <Link href="/map" className="primary-link">
            Mở bản đồ <Icon><path d="m9 18 6-6-6-6" /></Icon>
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Tổng thửa đất" value={stats.totalParcels} note="Trong cơ sở dữ liệu" icon={icons.parcels} tone="indigo" />
        <Metric label="Biến động phát hiện" value={stats.detectedChanges} note={`${changeRate}% tổng số thửa`} icon={icons.changes} tone="amber" />
        <Metric label="Chờ kiểm tra" value={stats.pendingInspections} note="Cần ưu tiên xử lý" icon={icons.pending} tone="rose" />
        <Metric label="Đã xử lý" value={stats.resolvedCases} note={`${resolutionRate}% tổng hồ sơ`} icon={icons.resolved} tone="emerald" />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.85fr)]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="eyebrow">Xu hướng giám sát</p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight">Biến động theo tháng</h3>
              <p className="mt-1 text-sm text-slate-500">Số cảnh báo được hệ thống ghi nhận.</p>
            </div>
            <span className={`trend-pill ${delta > 0 ? "trend-up" : ""}`}>
              {delta > 0 ? "Tăng" : delta < 0 ? "Giảm" : "Ổn định"} {Math.abs(delta)}% kỳ gần nhất
            </span>
          </div>
          <div className="relative mt-6 h-[280px]">
            <div className="chart-grid absolute inset-x-0 bottom-8 top-0" />
            <div className="absolute inset-x-0 bottom-0 top-0 flex items-end gap-2 sm:gap-4">
              {trend.map(([month, value]) => (
                <div className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" key={month}>
                  <div className="chart-tooltip">{value} cảnh báo</div>
                  <div className="bar-shell">
                    <div className="bar-fill" style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
                  </div>
                  <span className="mt-3 max-w-full truncate text-xs font-medium text-slate-500">{month}</span>
                </div>
              ))}
              {!trend.length && <div className="grid h-full w-full place-items-center text-sm text-slate-400">Chưa có dữ liệu xu hướng</div>}
            </div>
          </div>
        </Card>

        <Card>
          <p className="eyebrow">Hiệu suất xử lý</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">Tiến độ xác minh</h3>
          <div className="mt-7 flex items-center gap-6">
            <div className="donut" style={{ "--progress": `${resolutionRate * 3.6}deg` } as React.CSSProperties}>
              <div><strong>{resolutionRate}%</strong><span>hoàn tất</span></div>
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <Legend color="bg-emerald-500" label="Đã xử lý" value={stats.resolvedCases} />
              <Legend color="bg-amber-400" label="Đang chờ" value={stats.pendingInspections} />
            </div>
          </div>
          <div className="mt-7 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Khối lượng còn lại</span>
              <strong className="font-mono text-slate-950">{stats.pendingInspections}</strong>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${100 - resolutionRate}%` }} />
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-3">
        <Insight title="Tháng cao điểm" value={peak[0]} detail={`${peak[1]} cảnh báo được ghi nhận`} icon={<path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />} />
        <Insight title="Kỳ gần nhất" value={String(latest)} detail="cảnh báo mới trong tháng" icon={<path d="M12 3v18m7-7-7 7-7-7m14-4-7-7-7 7" />} />
        <Insight title="Mật độ biến động" value={`${changeRate}%`} detail="trên tổng số thửa được quản lý" icon={<path d="M4 19 19 4M7 5h.01M17 18h.01M8 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm10 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />} />
      </section>
    </div>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

function Metric({ label, value, note, icon, tone }: { label: string; value: number; note: string; icon: React.ReactNode; tone: string }) {
  return (
    <Card className="metric-card">
      <div className={`metric-icon metric-${tone}`}><Icon>{icon}</Icon></div>
      <p className="mt-6 text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-3xl font-semibold tracking-[-0.05em] text-slate-950">{value.toLocaleString("vi-VN")}</p>
      <p className="mt-3 text-xs font-medium text-slate-500">{note}</p>
    </Card>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return <div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${color}`} /><span className="flex-1 text-sm text-slate-500">{label}</span><strong className="font-mono text-sm">{value}</strong></div>;
}

function Insight({ title, value, detail, icon }: { title: string; value: string; detail: string; icon: React.ReactNode }) {
  return <Card className="flex items-center gap-4"><div className="insight-icon"><Icon>{icon}</Icon></div><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</p><p className="mt-1 text-xl font-semibold text-slate-950">{value}</p><p className="mt-0.5 text-xs text-slate-500">{detail}</p></div></Card>;
}
