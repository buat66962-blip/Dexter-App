import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Download, KeyRound, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import StatusBadge from "@/components/StatusBadge";
import PhotoHandover from "@/components/PhotoHandover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const fmt = (iso) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

const CONDITIONS = [
  { key: "BAIK", label: "🟢 Kondisi baik" },
  { key: "RUSAK_RINGAN", label: "🟡 Rusak ringan" },
  { key: "RUSAK_BERAT", label: "🔴 Rusak berat" },
  { key: "HILANG", label: "⚫ Hilang" },
];

export default function BookingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [b, setB] = useState(null);
  const [busy, setBusy] = useState(false);
  const [condition, setCondition] = useState("BAIK");
  const [notes, setNotes] = useState("");

  const load = () => api.get(`/bookings/${id}`).then(({ data }) => setB(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const grouped = useMemo(() => {
    const g = {};
    (b?.lines || []).forEach((l) => { (g[l.category || "Lainnya"] = g[l.category || "Lainnya"] || []).push(l); });
    return g;
  }, [b]);

  const downloadPdf = async () => {
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    let y = 20;
    const line = (t, size = 11, bold = false) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(t, 15, y);
      y += size < 13 ? 7 : 10;
    };
    line("INVOICE PEMINJAMAN ALAT", 17, true);
    line(`No. Invoice: INV-${b.code}`);
    y += 3;
    line(`Nama: ${b.user_name}`);
    line(`Tanggal Pengambilan: ${fmtDate(b.start_time)}`);
    line(`Tanggal Pengembalian: ${fmtDate(b.end_time)}`);
    line(`Durasi: ${b.duration_type === "days" ? `${Math.max(1, Math.round((b.duration_hours || 24) / 24))} hari` : `${b.duration_hours} jam (hari yang sama)`}`);
    line(`Acara: ${b.purpose}`);
    line(`Lokasi: ${b.location || "-"}`);
    y += 3;
    line("LIST ALAT", 13, true);
    Object.entries(grouped).forEach(([cat, list]) => {
      line(cat, 11, true);
      list.forEach((l) => line(`   ${l.name} (${l.qty} pcs) - ${l.item_code}`));
    });
    y += 3;
    if (b.access) {
      line("AKSES GUDANG", 13, true);
      line(`Pintu: ${b.access.door_name}`);
      line(`Kode: ${b.access.code}`);
      line(`Valid: ${fmtTime(b.access.valid_from)} - ${fmtTime(b.access.valid_until)}`);
    }
    line(`Status: ${b.status}`, 11, true);
    doc.save(`invoice-${b.code}.pdf`);
  };

  if (!b) return <p className="text-sm text-zinc-500">Memuat…</p>;

  const canReturn = ["APPROVED", "BORROWED", "OVERDUE"].includes(b.status);
  const canCancel = ["PENDING", "APPROVED"].includes(b.status);

  return (
    <div className="space-y-8">
      <button data-testid="back-button" onClick={() => navigate("/peminjaman")}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Pesanan Saya
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500">INVOICE INV-{b.code}</p>
          <h1 data-testid="booking-detail-title" className="mt-2 font-heading text-3xl font-bold tracking-tighter sm:text-4xl">
            {b.purpose}
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            Ambil {fmtDate(b.start_time)} · kembali {fmtDate(b.end_time)} · {b.total_qty} pcs
          </p>
        </div>
        <StatusBadge status={b.status} testId="booking-detail-status" />
      </div>

      {b.access && b.status !== "PENDING" ? (
        <div data-testid="access-card" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8">
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-emerald-400">
            <KeyRound className="h-4 w-4" /> Akses Gudang
          </p>
          <h2 className="mt-4 font-heading text-2xl font-semibold tracking-tight">{b.access.door_name}</h2>
          <p data-testid="access-code-value" className="mt-6 font-mono text-5xl font-bold tracking-[0.2em] text-emerald-400">
            {b.access.code}
          </p>
          <p className="mt-4 text-sm text-zinc-400">
            Berlaku {fmtTime(b.access.valid_from)} – {fmtTime(b.access.valid_until)}
          </p>
          <div className="mt-3"><StatusBadge status={b.access.status} testId="access-status" /></div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button data-testid="copy-access-code-button"
              onClick={() => { navigator.clipboard?.writeText(b.access.code); toast.success("Kode disalin"); }}
              className="h-12 rounded-full bg-emerald-500 px-6 font-semibold text-black hover:bg-emerald-400">
              <Copy className="mr-2 h-4 w-4" /> Copy Code
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button data-testid="how-to-open-button" variant="outline"
                  className="h-12 rounded-full border-white/10 bg-transparent px-6 text-zinc-200 hover:bg-white/10">
                  Cara Membuka Gudang
                </Button>
              </DialogTrigger>
              <DialogContent className="border-white/10 bg-zinc-900 text-zinc-100">
                <DialogHeader><DialogTitle className="font-heading">Cara Membuka Gudang</DialogTitle></DialogHeader>
                <ol className="space-y-3 text-sm text-zinc-300">
                  <li>1. Datang ke pintu {b.access.door_name}.</li>
                  <li>2. Sentuh keypad smart lock sampai menyala.</li>
                  <li>3. Masukkan kode {b.access.code} lalu tekan tombol pagar (#).</li>
                  <li>4. Pintu terbuka. Kode hanya aktif pada rentang waktu pesananmu.</li>
                </ol>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-zinc-900 p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Akses Gudang</p>
          <p className="mt-4 text-base text-zinc-400">Kode akses muncul di sini setelah order disetujui admin.</p>
        </div>
      )}

      <div data-testid="invoice-card" className="rounded-2xl border border-white/10 bg-zinc-900 p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">Invoice Peminjaman</h2>
            <p className="mt-2 text-sm text-zinc-500">Bukti & checklist alat — bukan invoice pembayaran.</p>
          </div>
          <Button data-testid="download-invoice-button" onClick={downloadPdf} variant="outline"
            className="rounded-full border-white/10 bg-transparent text-zinc-200 hover:bg-white/10">
            <Download className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>

        <dl className="mt-8 grid gap-6 sm:grid-cols-2">
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Nama</dt><dd className="mt-2">{b.user_name}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Tanggal Pengambilan</dt><dd className="mt-2">{fmtDate(b.start_time)}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Tanggal Pengembalian</dt><dd className="mt-2">{fmtDate(b.end_time)}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Durasi Peminjaman</dt>
            <dd className="mt-2">
              {b.duration_type === "days"
                ? `${Math.max(1, Math.round((b.duration_hours || 24) / 24))} hari`
                : `${b.duration_hours || "-"} jam (hari yang sama)`}
            </dd>
          </div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Acara</dt><dd className="mt-2">{b.purpose}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Lokasi</dt><dd className="mt-2">{b.location || "-"}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Total Alat</dt><dd className="mt-2">{b.total_qty} pcs</dd></div>
        </dl>

        <div className="mt-8 space-y-6">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">List Alat</p>
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} data-testid={`invoice-group-${cat.toLowerCase().replace(/[^a-z0-9]/g, "-")}`} className="space-y-2">
              <p className="font-heading text-base font-semibold text-zinc-200">{cat}</p>
              {list.map((l) => (
                <div key={l.item_id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3 text-sm">
                  <span>{l.name}</span>
                  <span className="font-mono text-zinc-400">{l.qty} pcs · {l.item_code}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {b.calendar && (
          <p className="mt-6 text-xs text-zinc-500">
            Google Calendar: {b.calendar.status}{b.calendar.simulated ? " (simulasi)" : ""}
          </p>
        )}
      </div>

      {["APPROVED", "BORROWED", "OVERDUE", "RETURN_REQUESTED", "RETURNED"].includes(b.status) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <PhotoHandover bookingId={id} phase="pickup" photos={b.pickup_photos}
            locked={["RETURNED"].includes(b.status)}
            lockedText="Order sudah selesai, foto pengambilan dikunci."
            onSaved={setB} />
          <PhotoHandover bookingId={id} phase="return" photos={b.return_photos}
            locked={!b.checklist_unlocked || b.status === "RETURNED"}
            lockedText={b.status === "RETURNED" ? "Order sudah selesai, foto pengembalian dikunci."
              : `Terbuka pada tanggal pengembalian (${fmtDate(b.end_time)}).`}
            onSaved={setB} />
        </div>
      )}

      {canReturn && (
        <div data-testid="return-checklist-card" className="rounded-2xl border border-white/10 bg-zinc-900 p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-2xl font-semibold tracking-tight">Checklist Pengembalian</h2>
              <p className="mt-2 text-sm text-zinc-500">
                {b.checklist_unlocked
                  ? "Centang setiap alat yang sudah dikembalikan ke gudang."
                  : `Terbuka pada hari pengembalian (${fmtDate(b.end_time)}).`}
              </p>
            </div>
            {!b.checklist_unlocked && (
              <span data-testid="checklist-locked-badge"
                className="inline-flex items-center gap-2 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-3 py-1 text-xs font-semibold text-zinc-400">
                <Lock className="h-3 w-3" /> Terkunci
              </span>
            )}
          </div>

          <div className="mt-6 space-y-2">
            {b.checklist.map((row) => (
              <label key={row.item_id} data-testid={`checklist-row-${row.item_code}`}
                className={`flex items-center gap-4 rounded-xl px-4 py-3 ${b.checklist_unlocked ? "bg-zinc-950/60 hover:bg-zinc-950" : "bg-zinc-950/30 opacity-60"}`}>
                <Checkbox
                  data-testid={`checklist-checkbox-${row.item_code}`}
                  checked={!!row.checked}
                  disabled={!b.checklist_unlocked || busy}
                  onCheckedChange={(v) =>
                    act(() => api.post(`/bookings/${id}/checklist`, { item_id: row.item_id, checked: !!v }),
                      v ? `${row.name} dicentang` : `${row.name} dibatalkan`)}
                />
                <span className="flex-1 text-sm">{row.name}</span>
                <span className="font-mono text-xs text-zinc-500">{row.qty} pcs</span>
              </label>
            ))}
          </div>

          {b.checklist_unlocked && !b.checklist_complete && (
            <p className="mt-4 text-sm text-amber-400">Centang semua alat dulu sebelum mengajukan pengembalian.</p>
          )}

          <div className="mt-6">
            <Dialog>
              <DialogTrigger asChild>
                <Button data-testid="open-return-dialog-button" disabled={!b.checklist_complete}
                  className="h-14 rounded-full bg-[#007AFF] px-8 text-base font-semibold text-white hover:bg-[#0069DB] disabled:opacity-40">
                  Ajukan Pengembalian
                </Button>
              </DialogTrigger>
              <DialogContent className="border-white/10 bg-zinc-900 text-zinc-100">
                <DialogHeader><DialogTitle className="font-heading">Pengembalian Alat</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="grid gap-2">
                    {CONDITIONS.map((c) => (
                      <button key={c.key} data-testid={`condition-${c.key}`} onClick={() => setCondition(c.key)}
                        className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors duration-200 ${
                          condition === c.key ? "border-[#007AFF] bg-[#007AFF]/10" : "border-white/10 hover:border-white/20"}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                  {condition !== "BAIK" && (
                    <Textarea data-testid="return-notes-input" value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="Catatan kerusakan / kehilangan"
                      className="min-h-24 rounded-xl border-white/10 bg-zinc-950" />
                  )}
                  <Button data-testid="submit-return-button" disabled={busy}
                    onClick={() => act(() => api.post(`/bookings/${id}/return`, { condition, notes }), "Permintaan pengembalian dikirim")}
                    className="h-12 w-full rounded-full bg-[#007AFF] font-semibold text-white hover:bg-[#0069DB]">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kirim"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      )}

      {canCancel && (
        <Button data-testid="cancel-booking-button" variant="outline" disabled={busy}
          onClick={() => act(() => api.post(`/bookings/${id}/cancel`), "Order dibatalkan")}
          className="h-14 rounded-full border-white/10 bg-transparent px-8 text-base text-zinc-300 hover:bg-white/10">
          Batalkan Order
        </Button>
      )}
    </div>
  );
}
