import { AlertStatus, AlertType, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const center = { lat: 10.7605, lng: 106.8727 };

const departments = [
  ["Construction Department", "Xây dựng", "#2563eb"],
  ["Land Administration", "Địa chính", "#16a34a"],
  ["Environment Department", "Môi trường", "#0891b2"],
  ["Transport/Public Works", "Giao thông - Công trình công cộng", "#f97316"]
] as const;

const streets = ["Đường Bình Lợi", "Đường Rạch Lá", "Đường Kênh Đông", "Đường Cây Dầu", "Đường Liên Ấp"];
const hamlets = ["Ấp 1", "Ấp 2", "Ấp 3", "Ấp Bình An", "Ấp Rạch Lá"];
const landUses = ["Đất ở nông thôn", "Đất trồng cây lâu năm", "Đất thương mại dịch vụ", "Đất giao thông", "Đất thủy lợi"];
const owners = ["Nguyễn Văn An", "Trần Thị Bình", "Lê Minh Châu", "Phạm Quốc Dũng", "Võ Thị Hạnh", "Huỳnh Gia Khang", "Đặng Mỹ Linh", "Bùi Thanh Sơn", "Đỗ Hoàng Nam", "Mai Thu Hà"];

async function main() {
  await prisma.inspectionNote.deleteMany();
  await prisma.satelliteImage.deleteMany();
  await prisma.changeAlert.deleteMany();
  await prisma.building.deleteMany();
  await prisma.parcel.deleteMany();
  await prisma.inspector.deleteMany();
  await prisma.department.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.create({ data: { email: "demo@binhloi.gov.vn", name: "Cán bộ demo", role: "admin" } });

  const deptRows = await Promise.all(departments.map(([name, label, color]) => prisma.department.create({ data: { name: label, color } })));
  await Promise.all(["Nguyễn Thanh Tùng", "Trần Mỹ Duyên", "Lê Hoàng Phúc", "Phạm Anh Khoa", "Võ Kim Ngân"].map((name, i) => prisma.inspector.create({
    data: { name, phone: `090${i + 1}12345${i}`, email: `inspector${i + 1}@binhloi.gov.vn`, departmentId: deptRows[i % deptRows.length].id }
  })));

  const parcels = [];
  for (let i = 1; i <= 30; i++) {
    const lat = center.lat + ((i % 6) - 3) * 0.0021;
    const lng = center.lng + (Math.floor(i / 6) - 2) * 0.0022;
    parcels.push(await prisma.parcel.create({
      data: {
        parcelId: `BL-${String(i).padStart(3, "0")}`,
        houseNumber: String(10 + i),
        streetName: streets[i % streets.length],
        hamlet: hamlets[i % hamlets.length],
        landLotNumber: String(120 + i),
        mapSheetNumber: `TBD-${1 + (i % 4)}`,
        ownerName: owners[i % owners.length],
        areaM2: 180 + i * 23,
        landUseType: landUses[i % landUses.length],
        gpsLat: lat,
        gpsLng: lng,
        polygonGeojson: square(lat, lng, 0.00055)
      }
    }));
  }

  for (let i = 0; i < 20; i++) {
    const p = parcels[i];
    await prisma.building.create({
      data: {
        parcelId: p.id,
        name: `Nhà / công trình ${i + 1}`,
        floors: 1 + (i % 4),
        footprintM2: 55 + i * 4,
        polygonGeojson: square(p.gpsLat + 0.0001, p.gpsLng - 0.0001, 0.00022)
      }
    });
  }

  const alertTypes = Object.values(AlertType);
  for (let i = 0; i < 10; i++) {
    const p = parcels[i * 2];
    const type = alertTypes[i % alertTypes.length];
    const department = deptRows[departmentIndex(type)];
    const alert = await prisma.changeAlert.create({
      data: {
        title: alertTitle(type),
        type,
        status: [AlertStatus.NEW, AlertStatus.UNDER_REVIEW, AlertStatus.FIELD_INSPECTION, AlertStatus.RESOLVED][i % 4],
        confidence: Number((0.72 + (i % 5) * 0.05).toFixed(2)),
        location: `${p.houseNumber} ${p.streetName}, ${p.hamlet}, Bình Lợi`,
        gpsLat: p.gpsLat + 0.00025,
        gpsLng: p.gpsLng + 0.00018,
        parcelId: p.id,
        departmentId: department.id,
        detectedAt: new Date(2026, i % 6, 5 + i)
      }
    });
    await prisma.satelliteImage.createMany({
      data: [
        { alertId: alert.id, kind: "before", imageUrl: demoImage("before", type, p.parcelId), capturedAt: new Date(2026, i % 6, 1) },
        { alertId: alert.id, kind: "after", imageUrl: demoImage("after", type, p.parcelId), capturedAt: new Date(2026, i % 6, 12) }
      ]
    });
    await prisma.inspectionNote.create({
      data: { alertId: alert.id, author: "Hệ thống", content: "Cảnh báo demo từ dữ liệu mẫu. Cần xác minh thực địa trước khi xử lý." }
    });
  }
}

function departmentIndex(type: AlertType) {
  if (type === "LAND_USE_CHANGE") return 1;
  if (type === "WATER_CANAL_ENCROACHMENT") return 2;
  if (type === "ROAD_CHANGE") return 3;
  return 0;
}

function alertTitle(type: AlertType) {
  const labels: Record<AlertType, string> = {
    NEW_BUILDING: "Phát hiện công trình mới",
    EXPANDED_BUILDING: "Dấu hiệu mở rộng công trình",
    POSSIBLE_ILLEGAL_CONSTRUCTION: "Nghi vấn xây dựng không phép",
    LAND_USE_CHANGE: "Biến động mục đích sử dụng đất",
    ROAD_CHANGE: "Thay đổi hạ tầng giao thông",
    WATER_CANAL_ENCROACHMENT: "Nghi vấn lấn chiếm kênh rạch"
  };
  return labels[type];
}

function square(lat: number, lng: number, d: number) {
  return { type: "Polygon", coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] };
}

function demoImage(stage: "before" | "after", type: AlertType, parcelId: string) {
  const change = stage === "after";
  const label = stage === "before" ? "TRUOC" : "SAU";
  const typeText = alertTitle(type);
  const changedShape = change ? changedSvg(type) : "";
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <pattern id="field" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M0 16h32M16 0v32" stroke="#d1d5db" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="640" height="360" fill="#edf2e7"/>
    <path d="M0 82 C110 52 160 100 232 78 S390 52 640 92 L640 0 L0 0Z" fill="#9fd3dc"/>
    <path d="M20 290 C120 230 230 292 338 245 S520 208 640 238" fill="none" stroke="#f3e66d" stroke-width="18"/>
    <path d="M20 290 C120 230 230 292 338 245 S520 208 640 238" fill="none" stroke="#b9a938" stroke-width="2"/>
    <rect x="70" y="118" width="420" height="178" fill="url(#field)" stroke="#2f8f55" stroke-width="3"/>
    <path d="M70 178h420M160 118v178M250 118v178M340 118v178M430 118v178" stroke="#2f8f55" stroke-width="2"/>
    <rect x="178" y="166" width="54" height="42" fill="#8d99ae" stroke="#334155" stroke-width="3"/>
    <rect x="290" y="198" width="46" height="38" fill="#8d99ae" stroke="#334155" stroke-width="3"/>
    <rect x="390" y="150" width="52" height="44" fill="#8d99ae" stroke="#334155" stroke-width="3"/>
    ${changedShape}
    <rect x="0" y="0" width="640" height="44" fill="#111827" opacity=".88"/>
    <text x="18" y="28" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#fff">${label} - ${parcelId}</text>
    <text x="620" y="28" font-family="Arial, sans-serif" font-size="14" text-anchor="end" fill="#d1fae5">${typeText}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function changedSvg(type: AlertType) {
  const region = `<rect x="360" y="170" width="104" height="70" fill="none" stroke="#dc2626" stroke-width="5" stroke-dasharray="10 7"/><text x="412" y="260" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#dc2626">VUNG NGHI VAN</text>`;
  const shapes: Record<AlertType, string> = {
    NEW_BUILDING: `<rect x="374" y="182" width="72" height="46" fill="#ef4444" stroke="#7f1d1d" stroke-width="3"/>${region}`,
    EXPANDED_BUILDING: `<rect x="390" y="150" width="52" height="44" fill="#8d99ae" stroke="#334155" stroke-width="3"/><rect x="442" y="150" width="42" height="44" fill="#ef4444" stroke="#7f1d1d" stroke-width="3"/>${region}`,
    POSSIBLE_ILLEGAL_CONSTRUCTION: `<rect x="372" y="178" width="88" height="56" fill="#f97316" stroke="#7c2d12" stroke-width="3"/><path d="M372 178l44-28 44 28" fill="#dc2626"/>${region}`,
    LAND_USE_CHANGE: `<rect x="350" y="156" width="128" height="96" fill="#c084fc" opacity=".75" stroke="#7e22ce" stroke-width="3"/>${region}`,
    ROAD_CHANGE: `<path d="M322 260 L510 112" stroke="#ef4444" stroke-width="18"/><path d="M322 260 L510 112" stroke="#fff" stroke-width="3" stroke-dasharray="15 10"/>${region}`,
    WATER_CANAL_ENCROACHMENT: `<path d="M430 80 C420 132 434 172 402 224" stroke="#0e7490" stroke-width="34" fill="none"/><rect x="382" y="170" width="70" height="52" fill="#ef4444" stroke="#7f1d1d" stroke-width="3"/>${region}`
  };
  return shapes[type];
}

main().finally(() => prisma.$disconnect());
