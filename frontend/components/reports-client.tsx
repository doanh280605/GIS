"use client";

import { useEffect, useState } from "react";
import { API_URL, api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { typeLabels } from "@/lib/labels";

type Monthly = { commune: string; period: string; totalAlerts: number; byType: Record<string, number>; byDepartment: Record<string, number> };

export function ReportsClient() {
  const [report, setReport] = useState<Monthly | null>(null);
  useEffect(() => { api<Monthly>("/api/reports/monthly").then(setReport); }, []);

  function pdf() {
    if (!report) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<html><head><title>Báo cáo kiểm tra</title><style>body{font-family:Arial;padding:32px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style></head><body><h1>Báo cáo biến động tháng ${report.period}</h1><p>Địa bàn: ${report.commune}</p><p>Tổng cảnh báo: ${report.totalAlerts}</p><h2>Theo loại biến động</h2><table>${Object.entries(report.byType).map(([k,v]) => `<tr><td>${typeLabels[k] || k}</td><td>${v}</td></tr>`).join("")}</table><script>window.print()</script></body></html>`);
  }

  return (
    <div className="workspace-page p-4 sm:p-6 lg:p-8">
      <div className="workspace-page-head mb-6">
        <p className="workspace-eyebrow">Dữ liệu và hồ sơ</p>
        <h2 className="mt-2 text-3xl">Báo cáo</h2>
        <p className="mt-2 text-sm text-slate-500">Xuất dữ liệu phục vụ kiểm tra và báo cáo.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="font-semibold">Xuất CSV cảnh báo</h3>
          <p className="mt-2 text-sm text-slate-500">Tải danh sách cảnh báo để xử lý bằng Excel.</p>
          <a href={`${API_URL}/api/export/alerts.csv`} className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white">Tải CSV</a>
        </Card>
        <Card>
          <h3 className="font-semibold">Phiếu kiểm tra PDF</h3>
          <p className="mt-2 text-sm text-slate-500">Tạo báo cáo in nhanh từ dữ liệu tháng.</p>
          <Button className="mt-4" onClick={pdf}>Tạo PDF</Button>
        </Card>
        <Card>
          <h3 className="font-semibold">Tóm tắt tháng</h3>
          <p className="mt-2 text-3xl font-semibold">{report?.totalAlerts ?? 0}</p>
          <p className="text-sm text-slate-500">cảnh báo trong kỳ {report?.period}</p>
        </Card>
      </div>
      <Card className="mt-6">
        <h3 className="mb-4 font-semibold">Phân loại cảnh báo</h3>
        <div className="space-y-3">
          {Object.entries(report?.byType || {}).map(([k, v]) => (
            <div className="flex items-center justify-between border-b border-border pb-2" key={k}>
              <span>{typeLabels[k] || k}</span><b>{v}</b>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
