"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, Parcel } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const blank = {
  parcelId: "", houseNumber: "", streetName: "", hamlet: "", landLotNumber: "", mapSheetNumber: "",
  ownerName: "", areaM2: 100, landUseType: "Đất ở nông thôn", gpsLat: 10.7605, gpsLng: 106.8727
};

export function ParcelsClient() {
  const [rows, setRows] = useState<Parcel[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Parcel | null>(null);
  const [form, setForm] = useState<Record<string, string | number>>(blank);

  useEffect(() => { load(); }, []);

  async function load(query = q) {
    setRows(await api<Parcel[]>(`/api/parcels${query ? `?q=${encodeURIComponent(query)}` : ""}`));
  }

  function edit(row?: Parcel) {
    setEditing(row || null);
    setForm(row || blank);
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    await api(editing ? `/api/parcels/${editing.id}` : "/api/parcels", { method: editing ? "PATCH" : "POST", body: JSON.stringify(form) });
    setOpen(false);
    await load();
  }

  return (
    <div className="workspace-page p-4 sm:p-6 lg:p-8">
      <div className="workspace-page-head mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="workspace-eyebrow">Hồ sơ địa chính</p>
          <h2 className="mt-2 text-3xl">Danh sách thửa đất</h2>
        </div>
        <Button onClick={() => edit()}>Thêm thửa đất</Button>
      </div>
      <Card>
        <div className="mb-4 flex gap-2">
          <Input placeholder="Tìm theo địa chỉ, mã thửa, chủ sử dụng" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button onClick={() => load()}>Tìm</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-slate-500">
              <tr><th className="py-3">Mã thửa</th><th>Địa chỉ</th><th>Chủ sử dụng</th><th>Diện tích</th><th>Loại đất</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr className="border-b border-border" key={r.id}>
                  <td className="py-3 font-medium">{r.parcelId}</td>
                  <td>{r.houseNumber} {r.streetName}, {r.hamlet}</td>
                  <td>{r.ownerName}</td>
                  <td>{r.areaM2} m2</td>
                  <td>{r.landUseType}</td>
                  <td><button className="text-primary" onClick={() => edit(r)}>Sửa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <form onSubmit={submit} className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl dark:bg-slate-950">
            <h3 className="mb-4 text-lg font-semibold">{editing ? "Cập nhật thửa đất" : "Thêm thửa đất"}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.keys(blank).map((key) => (
                <label className="text-sm" key={key}>{label(key)}
                  <Input className="mt-1" value={form[key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [key]: ["areaM2", "gpsLat", "gpsLng"].includes(key) ? Number(e.target.value) : e.target.value }))} />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" className="bg-slate-700" onClick={() => setOpen(false)}>Hủy</Button>
              <Button>Lưu</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function label(key: string) {
  const labels: Record<string, string> = {
    parcelId: "Mã thửa", houseNumber: "Số nhà", streetName: "Tên đường", hamlet: "Ấp",
    landLotNumber: "Số thửa", mapSheetNumber: "Tờ bản đồ", ownerName: "Chủ sử dụng",
    areaM2: "Diện tích m2", landUseType: "Loại đất", gpsLat: "Vĩ độ", gpsLng: "Kinh độ"
  };
  return labels[key] || key;
}
