import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");

const StatCard = ({ label, value, testId, accent }) => (
  <div data-testid={testId} className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{label}</p>
    <p className={`mt-3 font-heading text-3xl font-bold ${accent || "text-zinc-100"}`}>{value}</p>
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
  const [settings, setSettings] = useState({ buffer_before_minutes: 10, buffer_after_minutes: 15 });
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", category: "", item_code: "", photo: "", condition: "BAIK", location: "Gudang Utama" });

  const load = useCallback(async () => {
    try {
      const [s, b, i, a, al, au, nl, st] = await Promise.all([
        api.get("/admin/stats"), api.get("/admin/bookings"), api.get("/items"),
        api.get("/admin/access-credentials"), api.get("/admin/access-logs"),
        api.get("/admin/audit-logs"), api.get("/admin/notifications-log"), api.get("/settings"),
      ]);
      setStats(s.data); setBookings(b.data); setItems(i.data); setAccess(a.data);
      setAccessLogs(al.data); setAuditLogs(au.data); setNotifLogs(nl.data); setSettings(st.data);
    } catch (e) { toast.error(errMsg(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

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
          {[["approval", "Approval"], ["peminjaman", "Peminjaman"], ["akses", "Akses"], ["inventaris", "Inventaris"], ["log", "Log"], ["pengaturan", "Pengaturan"]].map(([v, l]) => (
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
                      <p className="mt-2 text-sm text-zinc-400">{b.items.map((i) => i.name).join(", ")}</p>
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
                      <p className="mt-2 text-sm text-zinc-400">{b.items.map((i) => i.name).join(", ")}</p>
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
                    <h3 className="mt-1 font-heading text-lg">{b.user_name} — {b.items.map((i) => i.name).join(", ")}</h3>
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
                  <p className="mt-1 text-sm">{b.items.map((i) => i.name).join(", ")}</p>
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

        <TabsContent value="inventaris" className="mt-8 space-y-6">
          <Dialog>
            <DialogTrigger asChild>
              <Button data-testid="add-item-button" className="h-12 rounded-full bg-[#007AFF] px-6 font-semibold text-white hover:bg-[#0069DB]">
                Tambah Barang
              </Button>
            </DialogTrigger>
            <DialogContent className="border-white/10 bg-zinc-900 text-zinc-100">
              <DialogHeader><DialogTitle className="font-heading">Tambah Barang</DialogTitle></DialogHeader>
              <div className="space-y-4">
                {[["name", "Nama"], ["category", "Kategori"], ["item_code", "Kode Barang"], ["photo", "URL Foto"]].map(([k, l]) => (
                  <div key={k} className="space-y-2">
                    <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">{l}</Label>
                    <Input data-testid={`item-${k}-input`} value={newItem[k]}
                      onChange={(e) => setNewItem({ ...newItem, [k]: e.target.value })}
                      className="h-12 rounded-xl border-white/10 bg-zinc-950" />
                  </div>
                ))}
                <Button data-testid="save-item-button" disabled={busy}
                  onClick={() => act(() => api.post("/items", newItem), "Barang ditambahkan")}
                  className="h-12 w-full rounded-full bg-[#007AFF] font-semibold text-white hover:bg-[#0069DB]">
                  Simpan
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <div data-testid="admin-items-list" className="space-y-3">
            {items.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-zinc-900 p-5">
                <div className="flex items-center gap-4">
                  <img src={i.photo} alt={i.name} className="h-14 w-14 rounded-xl object-cover" />
                  <div>
                    <p className="font-heading text-lg">{i.name}</p>
                    <p className="font-mono text-xs text-zinc-500">{i.item_code} · {i.category}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={i.status} />
                  <Button data-testid={`toggle-maintenance-${i.item_code}`} variant="outline" disabled={busy}
                    onClick={() => act(() => api.put(`/items/${i.id}`, { ...i, status: i.status === "MAINTENANCE" ? "AVAILABLE" : "MAINTENANCE" }), "Status diubah")}
                    className="h-10 rounded-full border-white/10 bg-transparent px-4 text-xs text-zinc-300 hover:bg-white/10">
                    {i.status === "MAINTENANCE" ? "Aktifkan" : "Maintenance"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
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

        <TabsContent value="pengaturan" className="mt-8 max-w-md space-y-6">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Buffer sebelum (menit)</Label>
            <Input data-testid="buffer-before-input" type="number" value={settings.buffer_before_minutes}
              onChange={(e) => setSettings({ ...settings, buffer_before_minutes: Number(e.target.value) })}
              className="h-12 rounded-xl border-white/10 bg-zinc-900" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Buffer sesudah (menit)</Label>
            <Input data-testid="buffer-after-input" type="number" value={settings.buffer_after_minutes}
              onChange={(e) => setSettings({ ...settings, buffer_after_minutes: Number(e.target.value) })}
              className="h-12 rounded-xl border-white/10 bg-zinc-900" />
          </div>
          <Button data-testid="save-settings-button" disabled={busy}
            onClick={() => act(() => api.put("/settings", {
              buffer_before_minutes: settings.buffer_before_minutes,
              buffer_after_minutes: settings.buffer_after_minutes,
            }), "Pengaturan disimpan")}
            className="h-12 rounded-full bg-[#007AFF] px-8 font-semibold text-white hover:bg-[#0069DB]">
            Simpan
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
