import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, History, Minus, Plus, MapPin } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import { useCart } from "@/context/CartContext";
import StatusBadge from "@/components/StatusBadge";

const fmt = (iso) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const { setQty, qtyOf } = useCart();

  useEffect(() => {
    api.get(`/items/${id}`).then(({ data }) => setItem(data)).catch((e) => toast.error(errMsg(e)));
  }, [id]);

  if (!item) return <p className="text-sm text-zinc-500">Memuat…</p>;
  const qty = qtyOf(item.id);

  return (
    <div className="space-y-8">
      <button data-testid="back-button" onClick={() => navigate("/")}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Kembali ke katalog
      </button>

      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900">
            <img src={item.photo} alt={item.name} className="max-h-[60vh] w-full object-cover" />
          </div>
          <div className="space-y-4">
            <StatusBadge status={item.status} testId="item-detail-status" />
            <h1 data-testid="item-detail-name" className="font-heading text-3xl font-bold tracking-tighter sm:text-4xl">
              {item.name}
            </h1>
            <p className="font-mono text-sm text-zinc-500">
              {item.item_code} · {item.category} · stok {item.quantity} pcs · kondisi {item.condition}
            </p>
            <p className="flex items-center gap-2 text-sm text-zinc-400"><MapPin className="h-4 w-4" /> {item.location}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <h3 className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-400">
              <CalendarClock className="h-4 w-4" /> Jadwal Terpakai
            </h3>
            <div data-testid="item-schedule" className="mt-4 space-y-3">
              {item.schedule?.length ? item.schedule.map((s) => (
                <div key={s.booking_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{fmt(s.start_time)} — {fmt(s.end_time)}</p>
                    <p className="text-xs text-zinc-500">{s.user_name} · #{s.code} · {s.qty} pcs</p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              )) : <p className="text-sm text-zinc-500">Belum ada jadwal. Alat bebas dipinjam.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <h3 className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-400">
              <History className="h-4 w-4" /> Riwayat Peminjaman
            </h3>
            <div data-testid="item-history" className="mt-4 space-y-3">
              {item.history?.length ? item.history.map((h) => (
                <div key={h.booking_id} data-testid={`history-row-${h.code}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{h.user_name}</p>
                    <p className="text-xs text-zinc-500">
                      #{h.code} · {fmt(h.start_time)} — {fmt(h.end_time)}
                      {h.return_condition ? ` · kondisi ${h.return_condition}` : ""}
                    </p>
                    {h.purpose && <p className="mt-1 text-xs text-zinc-600">{h.purpose}</p>}
                  </div>
                  <StatusBadge status={h.status} />
                </div>
              )) : <p className="text-sm text-zinc-500">Belum ada riwayat peminjaman.</p>}
            </div>
          </div>
        </div>

        <div className="h-fit space-y-6 rounded-2xl border border-white/10 bg-zinc-900 p-6 lg:sticky lg:top-28">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Tambah ke Pesanan</h2>
          <p className="text-sm text-zinc-500">
            Pilih jumlah, lalu lanjut ke halaman pesanan untuk mengisi tanggal, durasi, acara, dan lokasi.
          </p>

          {item.status === "MAINTENANCE" ? (
            <p className="text-sm text-rose-400">Alat sedang maintenance dan tidak bisa dipesan.</p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-xl border border-white/10 px-4 py-3">
                <button data-testid="detail-dec-button" onClick={() => setQty(item, qty - 1)} disabled={qty === 0}
                  className="rounded-full p-2 text-zinc-300 hover:bg-white/10 disabled:opacity-30">
                  <Minus className="h-4 w-4" />
                </button>
                <span data-testid="detail-qty" className="font-mono text-lg">{qty} pcs</span>
                <button data-testid="detail-inc-button" onClick={() => setQty(item, Math.min(item.quantity, qty + 1))}
                  disabled={qty >= item.quantity}
                  className="rounded-full p-2 text-zinc-300 hover:bg-white/10 disabled:opacity-30">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button data-testid="detail-checkout-button" onClick={() => navigate(qty > 0 ? "/checkout" : "/")}
                className="h-14 w-full rounded-full bg-[#007AFF] text-base font-semibold text-white transition-colors duration-200 hover:bg-[#0069DB]">
                {qty > 0 ? "Lanjut ke Pesanan" : "Pilih jumlah dulu"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
