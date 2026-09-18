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

const TZ = { timeZone: "Asia/Jakarta" };
const fmt = (iso) =>
  new Date(iso).toLocaleString("id-ID", { ...TZ, day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("id-ID", { ...TZ, hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) => new Date(iso).toLocaleDateString("id-ID", { ...TZ, day: "2-digit", month: "long", year: "numeric" });

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
    line(`Tanggal Pengambilan: ${fmt(b.start_time)}`);
    line(`Tanggal Pengembalian: ${fmt(b.end_time)}`);
    line(`Durasi: ${b.pickup_date === b.return_date ? "Hari yang sama" : `${b.duration_days || Math.max(1, Math.round((b.duration_hours || 24) / 24))} hari`}`);
    line(`Acara: ${b.purpose}`);
    y += 3;
    line("LIST PEMINJAMAN", 13, true);
    Object.entries(grouped).forEach(([cat, list]) => {
      line(cat, 11, true);
      list.forEach((l) => line(`   ${l.name} (${l.qty} pcs) - ${l.item_code}`));
    });
    y += 3;
    if (b.access_codes?.length) {
      line("AKSES STORAGE", 13, true);
      b.access_codes.forEach((ac) => {
        line(`${ac.kind === "RETURN" ? "Pengembalian" : "Pengambilan"} (${ac.door_name}): ${ac.released ? ac.code : "dikirim 1 jam sebelum jadwal"}`);
        line(`   Jadwal: ${fmt(ac.schedule_at)}`);
      });
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
        <ArrowLeft className="h-4 w-4" /> Booking Saya
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500">INVOICE INV-{b.code}</p>
          <h1 data-testid="booking-detail-title" className="mt-2 font-heading text-3xl font-bold tracking-tighter sm:text-4xl">
            {b.purpose}
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            Ambil {fmt(b.start_time)} · kembali {fmt(b.end_time)} · {b.total_qty} pcs
          </p>
        </div>
        <StatusBadge status={b.status} testId="booking-detail-status" />
      </div>

      {(b.access_codes?.length ? b.access_codes : []).length > 0 && b.status !== "PENDING" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {b.access_codes.map((ac) => {
            const label = ac.kind === "RETURN" ? "Pengembalian" : "Pengambilan";
            return (
              <div key={ac.id} data-testid={`access-card-${ac.kind.toLowerCase()}`}
                className={`rounded-2xl border p-8 ${ac.released ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-zinc-900"}`}>
                <p className={`flex items-center gap-2 text-xs uppercase tracking-[0.2em] ${ac.released ? "text-emerald-400" : "text-zinc-500"}`}>
                  {ac.released ? <KeyRound className="h-4 w-4" /> : <Lock className="h-4 w-4" />} Kode {label}
                </p>
                <h2 className="mt-4 font-heading text-xl font-semibold tracking-tight">{ac.door_name}</h2>
                {ac.released ? (
                  <>
                    <p data-testid={`access-code-${ac.kind.toLowerCase()}`}
                      className="mt-6 font-mono text-4xl font-bold tracking-[0.2em] text-emerald-400 sm:text-5xl">
                      {ac.code}
                    </p>
                    <p className="mt-4 text-sm text-zinc-400">
                      Berlaku {fmt(ac.valid_from)} – {fmtTime(ac.valid_until)}
                    </p>
                    <Button data-testid={`copy-access-code-${ac.kind.toLowerCase()}`}
                      onClick={() => { navigator.clipboard?.writeText(ac.code); toast.success("Kode disalin"); }}
                      className="mt-6 h-12 rounded-full bg-emerald-500 px-6 font-semibold text-black hover:bg-emerald-400">
                      <Copy className="mr-2 h-4 w-4" /> Copy Code
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="mt-6 font-mono text-4xl font-bold tracking-[0.3em] text-zinc-600 sm:text-5xl">• • • •</p>
                    <p data-testid={`access-locked-${ac.kind.toLowerCase()}`} className="mt-4 text-sm text-zinc-400">
                      Kode muncul otomatis 1 jam sebelum jadwal {label.toLowerCase()} ({fmt(ac.schedule_at)}),
                      yaitu sekitar {fmt(ac.release_at)}.
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-zinc-900 p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Akses Storage</p>
          <p className="mt-4 text-base text-zinc-400">
            Kode pintu (ambil &amp; kembali, berbeda) dibuat setelah booking disetujui admin, lalu dikirim 1 jam sebelum tiap jadwal.
          </p>
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
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Pengambilan</dt><dd className="mt-2">{fmt(b.start_time)}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Pengembalian</dt><dd className="mt-2">{fmt(b.end_time)}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Durasi Peminjaman</dt>
            <dd className="mt-2">
              {b.pickup_date && b.return_date && b.pickup_date === b.return_date
                ? "Hari yang sama"
                : `${b.duration_days || Math.max(1, Math.round((b.duration_hours || 24) / 24))} hari`}
            </dd>
          </div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Acara</dt><dd className="mt-2">{b.purpose}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Total Alat</dt><dd className="mt-2">{b.total_qty} pcs</dd></div>
        </dl>

        <div className="mt-8 space-y-6">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">List Peminjaman</p>
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
            lockedText="Booking sudah selesai, foto pengambilan dikunci."
            onSaved={setB} />
          <PhotoHandover bookingId={id} phase="return" photos={b.return_photos}
            locked={!b.checklist_unlocked || b.status === "RETURNED"}
            lockedText={b.status === "RETURNED" ? "Booking sudah selesai, foto pengembalian dikunci."
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
                  ? "Centang setiap alat yang sudah dikembalikan ke storage."
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
          onClick={() => act(() => api.post(`/bookings/${id}/cancel`), "Booking dibatalkan")}
          className="h-14 rounded-full border-white/10 bg-transparent px-8 text-base text-zinc-300 hover:bg-white/10">
          Batalkan Booking
        </Button>
      )}
    </div>
  );
}
