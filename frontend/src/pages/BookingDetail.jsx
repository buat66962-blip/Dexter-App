import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Download, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const fmt = (iso) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

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
  const receiptRef = useRef(null);

  const load = () => api.get(`/bookings/${id}`).then(({ data }) => setB(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const act = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const downloadPdf = async () => {
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    let y = 20;
    const line = (t, size = 11, bold = false) => {
      doc.setFontSize(size);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(t, 15, y);
      y += size < 12 ? 7 : 10;
    };
    line("BORROWING RECEIPT", 18, true);
    line(`Booking #${b.code}`, 11);
    y += 4;
    line(`Peminjam: ${b.user_name}`);
    line(`Waktu: ${fmt(b.start_time)} - ${fmtTime(b.end_time)}`);
    line(`Lokasi: ${b.items[0]?.location || "Gudang Utama"}`);
    line(`Keperluan: ${b.purpose}`);
    y += 4;
    line("BARANG", 13, true);
    b.items.forEach((i, idx) => line(`${idx + 1}. ${i.name} (${i.item_code}) - ${i.condition}`));
    y += 4;
    if (b.access) {
      line("ACCESS", 13, true);
      line(`Pintu: ${b.access.door_name}`);
      line(`Kode: ${b.access.code}`);
      line(`Valid: ${fmtTime(b.access.valid_from)} - ${fmtTime(b.access.valid_until)}`);
    }
    line(`Status: ${b.status}`, 11, true);
    doc.save(`receipt-${b.code}.pdf`);
  };

  if (!b) return <p className="text-sm text-zinc-500">Memuat…</p>;

  const canReturn = ["APPROVED", "BORROWED", "OVERDUE"].includes(b.status);
  const canCancel = ["PENDING", "APPROVED"].includes(b.status);

  return (
    <div className="space-y-8">
      <button data-testid="back-button" onClick={() => navigate("/peminjaman")}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Peminjaman Saya
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500">BOOKING #{b.code}</p>
          <h1 data-testid="booking-detail-title" className="mt-2 font-heading text-3xl font-bold tracking-tighter sm:text-4xl">
            {b.items.map((i) => i.name).join(", ")}
          </h1>
          <p className="mt-3 text-sm text-zinc-400">{fmt(b.start_time)} — {fmtTime(b.end_time)}</p>
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
                  <li>4. Pintu terbuka. Kode hanya aktif pada rentang waktu bookingmu.</li>
                </ol>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-zinc-900 p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Akses Gudang</p>
          <p className="mt-4 text-base text-zinc-400">
            Kode akses akan muncul di sini setelah booking disetujui admin.
          </p>
        </div>
      )}

      <div ref={receiptRef} data-testid="receipt-card" className="rounded-2xl border border-white/10 bg-zinc-900 p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">Borrowing Receipt</h2>
            <p className="mt-2 text-sm text-zinc-500">Bukti & checklist peminjaman — bukan invoice pembayaran.</p>
          </div>
          <Button data-testid="download-receipt-button" onClick={downloadPdf} variant="outline"
            className="rounded-full border-white/10 bg-transparent text-zinc-200 hover:bg-white/10">
            <Download className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>

        <dl className="mt-8 grid gap-6 sm:grid-cols-2">
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Peminjam</dt><dd className="mt-2">{b.user_name}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Keperluan</dt><dd className="mt-2">{b.purpose}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Waktu</dt><dd className="mt-2">{fmt(b.start_time)} — {fmtTime(b.end_time)}</dd></div>
          <div><dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">Lokasi</dt><dd className="mt-2">{b.items[0]?.location || "Gudang Utama"}</dd></div>
        </dl>

        <div className="mt-8 overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-950/60 text-xs uppercase tracking-[0.15em] text-zinc-500">
              <tr><th className="px-4 py-3">No</th><th className="px-4 py-3">Barang</th><th className="px-4 py-3">Kode</th><th className="px-4 py-3">Kondisi</th></tr>
            </thead>
            <tbody>
              {b.items.map((i, idx) => (
                <tr key={i.id} className="border-t border-white/5">
                  <td className="px-4 py-3 text-zinc-500">{idx + 1}</td>
                  <td className="px-4 py-3">{i.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{i.item_code}</td>
                  <td className="px-4 py-3 text-zinc-400">{i.condition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {b.calendar && (
          <p className="mt-6 text-xs text-zinc-500">
            Google Calendar: {b.calendar.status}{b.calendar.simulated ? " (simulasi)" : ""}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {canReturn && (
          <Dialog>
            <DialogTrigger asChild>
              <Button data-testid="open-return-dialog-button"
                className="h-14 rounded-full bg-[#007AFF] px-8 text-base font-semibold text-white hover:bg-[#0069DB]">
                Kembalikan Barang
              </Button>
            </DialogTrigger>
            <DialogContent className="border-white/10 bg-zinc-900 text-zinc-100">
              <DialogHeader><DialogTitle className="font-heading">Pengembalian Barang</DialogTitle></DialogHeader>
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
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ajukan Pengembalian"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {canCancel && (
          <Button data-testid="cancel-booking-button" variant="outline" disabled={busy}
            onClick={() => act(() => api.post(`/bookings/${id}/cancel`), "Booking dibatalkan")}
            className="h-14 rounded-full border-white/10 bg-transparent px-8 text-base text-zinc-300 hover:bg-white/10">
            Batalkan Booking
          </Button>
        )}
      </div>
    </div>
  );
}
