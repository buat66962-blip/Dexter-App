import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import StatusBadge from "@/components/StatusBadge";

const fmt = (iso) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default function MyBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/bookings").then(({ data }) => setBookings(data))
      .catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Booking Saya</h1>

      {loading ? <p className="text-sm text-zinc-500">Memuat…</p> : (
        <div data-testid="my-bookings-list" className="space-y-4">
          {bookings.map((b) => (
            <Link key={b.id} to={`/peminjaman/${b.id}`} data-testid={`booking-row-${b.code}`}
              className="block rounded-2xl border border-white/10 bg-zinc-900 p-6 transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-white/20">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="font-mono text-xs text-zinc-500">INV-{b.code} · {b.total_qty} pcs</p>
                  <h3 className="font-heading text-xl font-medium tracking-tight">{b.purpose}</h3>
                  <p className="text-sm text-zinc-400">Ambil {fmtDate(b.start_time)} · kembali {fmtDate(b.end_time)}</p>
                  <p className="text-sm text-zinc-500">
                    {b.lines.slice(0, 3).map((l) => `${l.name} (${l.qty})`).join(", ")}
                    {b.lines.length > 3 ? ` +${b.lines.length - 3} lain` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <StatusBadge status={b.status} />
                  {b.access && b.status !== "PENDING" && (
                    <p className="font-mono text-sm text-emerald-400">Kode: {b.access.code}</p>
                  )}
                </div>
              </div>
            </Link>
          ))}
          {bookings.length === 0 && <p className="text-sm text-zinc-500">Belum ada booking.</p>}
        </div>
      )}
    </div>
  );
}
