import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");

const StatCard = ({ label, value, testId, accent }) => (
  <div data-testid={testId} className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
    <p className={`mt-3 font-heading text-3xl font-bold ${accent || "text-zinc-100"}`}>{value}</p>
  </div>
);


const ItemForm = ({ value, onChange, categories, prefix }) => (
  <div className="space-y-4">
    {[["name", "Nama"], ["item_code", "Kode Alat"], ["photo", "URL Foto"], ["location", "Lokasi"], ["condition", "Kondisi"]].map(([k, l]) => (
      <div key={k} className="space-y-2">
        <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">{l}</Label>
        <Input data-testid={`${prefix}-${k}-input`} value={value[k] || ""}
          onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          className="h-12 rounded-xl border-white/10 bg-zinc-950" />
      </div>
    ))}
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Kategori</Label>
      <Select value={value.category || ""} onValueChange={(v) => onChange({ ...value, category: v })}>
        <SelectTrigger data-testid={`${prefix}-category-select`} className="h-12 rounded-xl border-white/10 bg-zinc-950">
          <SelectValue placeholder="Pilih kategori" />
        </SelectTrigger>
        <SelectContent className="max-h-60 border-white/10 bg-zinc-900 text-zinc-100">
          {categories.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Jumlah Stok</Label>
      <Input data-testid={`${prefix}-quantity-input`} type="number" min="1" value={value.quantity ?? 1}
        onChange={(e) => onChange({ ...value, quantity: Number(e.target.value) })}
        className="h-12 rounded-xl border-white/10 bg-zinc-950" />
    </div>
  </div>
);

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [items, setItems] = useState([]);
  const [access, setAccess] = useState([]);
  const [accessLogs, setAccessLogs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [notifLogs, setNotifLogs] = useState([]);
  const [report, setReport] = useState(null);
  const [reportDays, setReportDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState([]);
  const [editItem, setEditItem] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", category: "", item_code: "", photo: "", condition: "BAIK", location: "Storage Utama", quantity: 1 });

  const load = useCallback(async () => {
    try {
      const [s, b, i, a, al, au, nl, cat] = await Promise.all([
        api.get("/admin/stats"), api.get("/admin/bookings"), api.get("/items"),
        api.get("/admin/access-credentials"), api.get("/admin/access-logs"),
        api.get("/admin/audit-logs"), api.get("/admin/notifications-log"), api.get("/categories"),
      ]);
      setStats(s.data); setBookings(b.data); setItems(i.data); setAccess(a.data);
      setAccessLogs(al.data); setAuditLogs(au.data); setNotifLogs(nl.data); setCategories(cat.data);
    } catch (e) { toast.error(errMsg(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get("/admin/reports", { params: { days: reportDays } })
      .then(({ data }) => setReport(data))
      .catch((e) => toast.error(errMsg(e)));
  }, [reportDays]);

  const exportCsv = async () => {
    const { data } = await api.get("/admin/reports/export", { params: { days: reportDays }, responseType: "blob" });
    const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `laporan-${reportDays}hari.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = async () => {
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    let y = 20;
    const line = (t, size = 11, bold = false) => {
      doc.setFontSize(size); doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(t, 15, y); y += size < 13 ? 7 : 10;
    };
    line(`LAPORAN PEMINJAMAN ${reportDays} HARI`, 16, true);
    line(`Total booking: ${report.totals.bookings} · Selesai: ${report.totals.returned} · Terlambat: ${report.totals.overdue}`);
    y += 4;
    line("BARANG PALING SERING DIPINJAM", 13, true);
    report.top_items.forEach((i, n) => line(`${n + 1}. ${i.name} — ${i.count}x`));
    y += 4;
    line("PEMINJAM TERAKTIF", 13, true);
    report.top_users.forEach((u, n) => line(`${n + 1}. ${u.name} — ${u.count}x`));
    y += 4;
    line("SERING TERLAMBAT", 13, true);
    (report.late_users.length ? report.late_users : [{ name: "Tidak ada", count: 0 }])
      .forEach((u, n) => line(`${n + 1}. ${u.name} — ${u.count}x`));
    doc.save(`laporan-${reportDays}hari.pdf`);
  };

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const pending = bookings.filter((b) => b.status === "PENDING");
  const returns = bookings.filter((b) => b.status === "RETURN_REQUESTED");
  const overdue = bookings.filter((b) => b.status === "OVERDUE");

  return (
    <div className="space-y-10">
      <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Admin Dashboard</h1>

      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Dipinjam" value={stats.borrowed} testId="stat-borrowed" accent="text-blue-400" />
          <StatCard label="Menunggu" value={stats.pending} testId="stat-pending" accent="text-amber-400" />
          <StatCard label="Tersedia" value={stats.available_items} testId="stat-available" accent="text-emerald-400" />
          <StatCard label="Overdue" value={stats.overdue} testId="stat-overdue" accent="text-rose-400" />
          <StatCard label="Akses Aktif" value={stats.active_access} testId="stat-access" accent="text-[#007AFF]" />
        </div>
      )}

      <Tabs defaultValue="approval">
        <TabsList className="flex w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          {[["approval", "Approval"], ["peminjaman", "Peminjaman"], ["akses", "Akses"], ["inventaris", "Inventaris"], ["laporan", "Laporan"], ["log", "Log"]].map(([v, l]) => (
            <TabsTrigger key={v} value={v} data-testid={`tab-${v}`}
              className="rounded-full border border-white/10 px-5 py-2 text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white">
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="approval" className="mt-8 space-y-8">
          <section className="space-y-4">
            <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-500">Booking Menunggu Approval</h2>
            <div data-testid="pending-bookings-list" className="space-y-4">
              {pending.map((b) => (
                <div key={b.id} data-testid={`pending-booking-${b.code}`} className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-xs text-zinc-500">#{b.code}</p>
                      <h3 className="mt-1 font-heading text-xl font-medium">{b.user_name}</h3>
                      <p className="mt-2 text-sm text-zinc-400">{b.lines.map((l) => `${l.name} (${l.qty})`).join(", ")}</p>
                      <p className="text-sm text-zinc-500">{fmt(b.start_time)} — {fmt(b.end_time)} · {b.purpose}</p>
                    </div>
                    <div className="flex gap-3">
                      <Button data-testid={`approve-button-${b.code}`} disabled={busy}
                        onClick={() => act(() => api.post(`/admin/bookings/${b.id}/approve`), "Booking disetujui, akses & calendar dibuat")}
                        className="h-12 rounded-full bg-emerald-500 px-6 font-semibold text-black hover:bg-emerald-400">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
                      </Button>
                      <Button data-testid={`reject-button-${b.code}`} variant="outline" disabled={busy}
                        onClick={() => act(() => api.post(`/admin/bookings/${b.id}/reject`, { reason: "Ditolak admin" }), "Booking ditolak")}
                        className="h-12 rounded-full border-rose-500/40 bg-transparent px-6 text-rose-400 hover:bg-rose-500/10">
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {pending.length === 0 && <p className="text-sm text-zinc-500">Tidak ada booking menunggu.</p>}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-500">Permintaan Pengembalian</h2>
            <div data-testid="return-requests-list" className="space-y-4">
              {returns.map((b) => (
                <div key={b.id} data-testid={`return-request-${b.code}`} className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-xs text-zinc-500">#{b.code}</p>
                      <h3 className="mt-1 font-heading text-xl font-medium">{b.user_name}</h3>
                      <p className="mt-2 text-sm text-zinc-400">{b.lines.map((l) => `${l.name} (${l.qty})`).join(", ")}</p>
                      <p className="text-sm text-zinc-500">Kondisi: {b.return_condition} {b.return_notes}</p>
                    </div>
                    <div className="flex gap-3">
                      <Button data-testid={`accept-return-button-${b.code}`} disabled={busy}
                        onClick={() => act(() => api.post(`/admin/bookings/${b.id}/confirm-return`), "Pengembalian diterima")}
                        className="h-12 rounded-full bg-emerald-500 px-6 font-semibold text-black hover:bg-emerald-400">
                        Terima
                      </Button>
                      <Button data-testid={`damaged-return-button-${b.code}`} variant="outline" disabled={busy}
                        onClick={() => act(() => api.post(`/admin/bookings/${b.id}/confirm-return?damaged=true`), "Ditandai rusak")}
                        className="h-12 rounded-full border-amber-500/40 bg-transparent px-6 text-amber-400 hover:bg-amber-500/10">
                        Rusak
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {returns.length === 0 && <p className="text-sm text-zinc-500">Tidak ada permintaan pengembalian.</p>}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-500">Overdue</h2>
            <div data-testid="overdue-list" className="space-y-4">
              {overdue.map((b) => (
                <div key={b.id} data-testid={`overdue-${b.code}`} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6">
                  <div>
                    <p className="font-mono text-xs text-zinc-500">#{b.code}</p>
                    <h3 className="mt-1 font-heading text-lg">{b.user_name} — {b.lines.map((l) => `${l.name} (${l.qty})`).join(", ")}</h3>
                    <p className="text-sm text-rose-300">Seharusnya kembali {fmt(b.end_time)}</p>
                  </div>
                  <div className="flex gap-3">
                    <Button data-testid={`extend-button-${b.code}`} variant="outline" disabled={busy}
                      onClick={() => act(() => api.post(`/admin/bookings/${b.id}/extend`, { minutes: 60 }), "Diperpanjang 60 menit")}
                      className="h-11 rounded-full border-white/10 bg-transparent px-5 text-zinc-200 hover:bg-white/10">
                      Extend 1 jam
                    </Button>
                    <Button data-testid={`force-return-button-${b.code}`} disabled={busy}
                      onClick={() => act(() => api.post(`/admin/bookings/${b.id}/confirm-return`), "Ditandai kembali")}
                      className="h-11 rounded-full bg-white px-5 font-semibold text-black hover:bg-zinc-200">
                      Tandai Kembali
                    </Button>
                  </div>
                </div>
              ))}
              {overdue.length === 0 && <p className="text-sm text-zinc-500">Tidak ada keterlambatan.</p>}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="peminjaman" className="mt-8">
          <div data-testid="all-bookings-list" className="space-y-3">
            {bookings.map((b) => (
              <Link key={b.id} to={`/peminjaman/${b.id}`}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900 p-5 transition-colors duration-200 hover:border-white/20">
                <div>
                  <p className="font-mono text-xs text-zinc-500">#{b.code} · {b.user_name}</p>
                  <p className="mt-1 text-sm">{b.lines.map((l) => `${l.name} (${l.qty})`).join(", ")}</p>
                  <p className="text-xs text-zinc-500">{fmt(b.start_time)} — {fmt(b.end_time)}</p>
                </div>
                <StatusBadge status={b.status} />
              </Link>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="akses" className="mt-8 space-y-4">
          <div data-testid="active-access-list" className="space-y-3">
            {access.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900 p-5">
                <div>
                  <p className="font-mono text-2xl font-bold text-emerald-400">{c.code}</p>
                  <p className="mt-1 text-sm text-zinc-400">#{c.booking_code} · {c.user_name}</p>
                  <p className="text-xs text-zinc-500">{fmt(c.valid_from)} — {fmt(c.valid_until)} {c.simulated ? "· simulasi" : ""}</p>
                </div>
                <div className="flex gap-3">
                  <Button data-testid={`regenerate-access-${c.booking_code}`} variant="outline" disabled={busy}
                    onClick={() => act(() => api.post(`/admin/bookings/${c.booking_id}/regenerate-access`), "Kode baru dibuat")}
                    className="h-11 rounded-full border-white/10 bg-transparent px-5 text-zinc-200 hover:bg-white/10">
                    Generate Ulang
                  </Button>
                  <Button data-testid={`disable-access-${c.booking_code}`} variant="outline" disabled={busy}
                    onClick={() => act(() => api.post(`/admin/bookings/${c.booking_id}/disable-access`), "Akses dimatikan")}
                    className="h-11 rounded-full border-rose-500/40 bg-transparent px-5 text-rose-400 hover:bg-rose-500/10">
                    Matikan
                  </Button>
                </div>
              </div>
            ))}
            {access.length === 0 && <p className="text-sm text-zinc-500">Tidak ada akses aktif.</p>}
          </div>
        </TabsContent>

        <TabsContent value="inventaris" className="mt-8 space-y-8">
          <section className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-400">Kategori Alat</h2>
            <div className="flex flex-wrap gap-2">
              <Input data-testid="new-category-input" value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)} placeholder="Nama kategori baru"
                className="h-12 max-w-xs rounded-xl border-white/10 bg-zinc-950" />
              <Button data-testid="add-category-button" disabled={busy || !newCategory.trim()}
                onClick={() => act(async () => { await api.post("/categories", { name: newCategory }); setNewCategory(""); }, "Kategori ditambahkan")}
                className="h-12 rounded-full bg-[#007AFF] px-6 font-semibold text-white hover:bg-[#0069DB]">
                Tambah Kategori
              </Button>
            </div>
            <div data-testid="category-list" className="space-y-2">
              {categories.map((c) => (
                <div key={c.name} data-testid={`category-row-${c.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3">
                  {renaming?.old === c.name ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <Input data-testid="rename-category-input" value={renaming.value}
                        onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                        className="h-10 max-w-xs rounded-lg border-white/10 bg-zinc-900" />
                      <Button data-testid="save-category-rename" disabled={busy}
                        onClick={() => act(async () => {
                          await api.put(`/categories/${encodeURIComponent(c.name)}`, { new_name: renaming.value });
                          setRenaming(null);
                        }, "Kategori diubah")}
                        className="h-10 rounded-full bg-[#007AFF] px-5 text-xs font-semibold text-white">Simpan</Button>
                      <Button variant="outline" onClick={() => setRenaming(null)}
                        className="h-10 rounded-full border-white/10 bg-transparent px-5 text-xs text-zinc-300">Batal</Button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="font-mono text-xs text-zinc-500">{c.item_count} jenis · {c.total_qty} pcs</p>
                      </div>
                      <div className="flex gap-2">
                        <Button data-testid={`rename-category-${c.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`} variant="outline"
                          onClick={() => setRenaming({ old: c.name, value: c.name })}
                          className="h-10 rounded-full border-white/10 bg-transparent px-4 text-xs text-zinc-300 hover:bg-white/10">
                          Ubah Nama
                        </Button>
                        <Button data-testid={`delete-category-${c.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`} variant="outline" disabled={busy}
                          onClick={() => act(() => api.delete(`/categories/${encodeURIComponent(c.name)}`), "Kategori dihapus")}
                          className="h-10 rounded-full border-rose-500/40 bg-transparent px-4 text-xs text-rose-400 hover:bg-rose-500/10">
                          Hapus
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-400">Daftar Alat</h2>
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="add-item-button" className="h-12 rounded-full bg-[#007AFF] px-6 font-semibold text-white hover:bg-[#0069DB]">
                    Tambah Alat
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-zinc-900 text-zinc-100">
                  <DialogHeader>
                    <DialogTitle className="font-heading">Tambah Alat</DialogTitle>
                    <DialogDescription className="text-zinc-500">Lengkapi data alat baru untuk katalog.</DialogDescription>
                  </DialogHeader>
                  <ItemForm value={newItem} onChange={setNewItem} categories={categories} prefix="item" />
                  <Button data-testid="save-item-button" disabled={busy}
                    onClick={() => act(async () => { await api.post("/items", newItem); setAddOpen(false); }, "Alat ditambahkan")}
                    className="h-12 w-full rounded-full bg-[#007AFF] font-semibold text-white hover:bg-[#0069DB]">
                    Simpan
                  </Button>
                </DialogContent>
              </Dialog>
            </div>

            <div data-testid="admin-items-list" className="space-y-3">
              {items.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900 p-5">
                  <div className="flex items-center gap-4">
                    <img src={i.photo} alt={i.name} className="h-14 w-14 rounded-xl object-cover" />
                    <div>
                      <p className="font-heading text-lg">{i.name}</p>
                      <p className="font-mono text-xs text-zinc-500">{i.item_code} · {i.category} · {i.quantity} pcs</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge status={i.status} />
                    <div className="flex items-center gap-2 rounded-full border border-white/10 px-2 py-1">
                      <button data-testid={`qty-dec-${i.item_code}`} disabled={busy || i.quantity <= 1}
                        onClick={() => act(() => api.put(`/items/${i.id}`, { ...i, quantity: i.quantity - 1 }), "Stok dikurangi")}
                        className="rounded-full p-2 text-zinc-300 hover:bg-white/10 disabled:opacity-30">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span data-testid={`qty-value-${i.item_code}`} className="min-w-10 text-center font-mono text-sm">{i.quantity}</span>
                      <button data-testid={`qty-inc-${i.item_code}`} disabled={busy}
                        onClick={() => act(() => api.put(`/items/${i.id}`, { ...i, quantity: i.quantity + 1 }), "Stok ditambah")}
                        className="rounded-full p-2 text-zinc-300 hover:bg-white/10 disabled:opacity-30">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Button data-testid={`edit-item-${i.item_code}`} variant="outline"
                      onClick={() => setEditItem({ ...i })}
                      className="h-10 rounded-full border-white/10 bg-transparent px-4 text-xs text-zinc-300 hover:bg-white/10">
                      Edit
                    </Button>
                    <Button data-testid={`toggle-maintenance-${i.item_code}`} variant="outline" disabled={busy}
                      onClick={() => act(() => api.put(`/items/${i.id}`, { ...i, status: i.status === "MAINTENANCE" ? "AVAILABLE" : "MAINTENANCE" }), "Status diubah")}
                      className="h-10 rounded-full border-white/10 bg-transparent px-4 text-xs text-zinc-300 hover:bg-white/10">
                      {i.status === "MAINTENANCE" ? "Aktifkan" : "Maintenance"}
                    </Button>
                    <Button data-testid={`delete-item-${i.item_code}`} variant="outline" disabled={busy}
                      onClick={() => act(() => api.delete(`/items/${i.id}`), "Alat dihapus")}
                      className="h-10 rounded-full border-rose-500/40 bg-transparent px-4 text-xs text-rose-400 hover:bg-rose-500/10">
                      Hapus
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <Dialog open={!!editItem} onOpenChange={(v) => !v && setEditItem(null)}>
            <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-zinc-900 text-zinc-100">
              <DialogHeader>
                <DialogTitle className="font-heading">Edit Alat</DialogTitle>
                <DialogDescription className="text-zinc-500">Ubah nama, kategori, kode, stok, atau foto alat.</DialogDescription>
              </DialogHeader>
              {editItem && (
                <>
                  <ItemForm value={editItem} onChange={setEditItem} categories={categories} prefix="edit-item" />
                  <Button data-testid="save-item-edit-button" disabled={busy}
                    onClick={() => act(async () => {
                      await api.put(`/items/${editItem.id}`, editItem);
                      setEditItem(null);
                    }, "Alat diperbarui")}
                    className="h-12 w-full rounded-full bg-[#007AFF] font-semibold text-white hover:bg-[#0069DB]">
                    Simpan Perubahan
                  </Button>
                </>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="laporan" className="mt-8 space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            {[7, 30, 90].map((d) => (
              <button key={d} data-testid={`report-range-${d}`} onClick={() => setReportDays(d)}
                className={`rounded-full border px-5 py-2 text-sm transition-colors duration-200 ${reportDays === d ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>
                {d} hari
              </button>
            ))}
            <Button data-testid="export-csv-button" variant="outline" onClick={exportCsv}
              className="ml-auto rounded-full border-white/10 bg-transparent text-zinc-200 hover:bg-white/10">
              Export CSV
            </Button>
            <Button data-testid="export-pdf-button" onClick={exportPdf}
              className="rounded-full bg-[#007AFF] font-semibold text-white hover:bg-[#0069DB]">
              Export PDF
            </Button>
          </div>

          {report && (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard label="Total Booking" value={report.totals.bookings} testId="report-total-bookings" />
                <StatCard label="Selesai" value={report.totals.returned} testId="report-returned" accent="text-emerald-400" />
                <StatCard label="Terlambat" value={report.totals.overdue} testId="report-overdue" accent="text-rose-400" />
                <StatCard label="Total Barang" value={report.totals.items} testId="report-items" />
              </div>

              <div data-testid="report-trend-chart" className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
                <h3 className="text-xs uppercase tracking-[0.2em] text-zinc-500">Tren Peminjaman</h3>
                <div className="mt-6 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={report.trend}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
                      <YAxis stroke="#71717a" fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
                      <Line type="monotone" dataKey="count" stroke="#007AFF" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div data-testid="report-top-items" className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
                  <h3 className="text-xs uppercase tracking-[0.2em] text-zinc-500">Barang Paling Sering Dipinjam</h3>
                  <div className="mt-6 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.top_items.slice(0, 6)} layout="vertical">
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                        <XAxis type="number" stroke="#71717a" fontSize={11} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" stroke="#71717a" fontSize={10} width={130} />
                        <Tooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
                        <Bar dataKey="count" fill="#10B981" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-6">
                  <div data-testid="report-top-users" className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
                    <h3 className="text-xs uppercase tracking-[0.2em] text-zinc-500">Peminjam Teraktif</h3>
                    <div className="mt-4 space-y-2">
                      {report.top_users.map((u) => (
                        <div key={u.name} className="flex justify-between rounded-xl bg-zinc-950/60 px-4 py-3 text-sm">
                          <span>{u.name}</span><span className="font-mono text-zinc-400">{u.count}x</span>
                        </div>
                      ))}
                      {report.top_users.length === 0 && <p className="text-sm text-zinc-500">Belum ada data.</p>}
                    </div>
                  </div>
                  <div data-testid="report-late-users" className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6">
                    <h3 className="text-xs uppercase tracking-[0.2em] text-rose-300">Sering Terlambat</h3>
                    <div className="mt-4 space-y-2">
                      {report.late_users.map((u) => (
                        <div key={u.name} className="flex justify-between rounded-xl bg-zinc-950/40 px-4 py-3 text-sm">
                          <span>{u.name}</span><span className="font-mono text-rose-300">{u.count}x</span>
                        </div>
                      ))}
                      {report.late_users.length === 0 && <p className="text-sm text-zinc-500">Tidak ada keterlambatan.</p>}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="log" className="mt-8 grid gap-8 lg:grid-cols-3">
          {[["Access Log", accessLogs, (l) => `${l.event} · ${l.status}`, "access-log-list"],
            ["Audit Log", auditLogs, (l) => l.action, "audit-log-list"],
            ["Notification Log", notifLogs, (l) => `${l.channel} · ${l.type} · ${l.status}`, "notification-log-list"]].map(([title, list, render, testId]) => (
            <div key={title} className="space-y-3">
              <h3 className="text-xs uppercase tracking-[0.2em] text-zinc-500">{title}</h3>
              <div data-testid={testId} className="space-y-2">
                {list.slice(0, 25).map((l) => (
                  <div key={l.id} className="rounded-xl border border-white/10 bg-zinc-900 px-4 py-3">
                    <p className="text-sm">{render(l)}</p>
                    <p className="text-xs text-zinc-600">{fmt(l.created_at || l.sent_at)}</p>
                  </div>
                ))}
                {list.length === 0 && <p className="text-sm text-zinc-500">Belum ada data.</p>}
              </div>
            </div>
          ))}
        </TabsContent>

      </Tabs>
    </div>
  );
}
