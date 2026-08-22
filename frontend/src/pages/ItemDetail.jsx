import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const fmt = (iso) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [form, setForm] = useState({ date: "", start: "09:00", end: "17:00", purpose: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/items/${id}`).then(({ data }) => setItem(data)).catch((e) => toast.error(errMsg(e)));
  }, [id]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.date) return toast.error("Pilih tanggal dulu");
    setSaving(true);
    try {
      const { data } = await api.post("/bookings", {
        item_ids: [id],
        start_time: `${form.date}T${form.start}:00+07:00`,
        end_time: `${form.date}T${form.end}:00+07:00`,
        purpose: form.purpose,
      });
      toast.success("Booking dibuat, menunggu approval admin");
      navigate(`/peminjaman/${data.id}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  if (!item) return <p className="text-sm text-zinc-500">Memuat…</p>;

  return (
    <div className="space-y-8">
      <button data-testid="back-button" onClick={() => navigate("/")}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Kembali
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
            <p className="font-mono text-sm text-zinc-500">{item.item_code} · {item.category} · Kondisi {item.condition}</p>
            <p className="flex items-center gap-2 text-sm text-zinc-400"><MapPin className="h-4 w-4" /> {item.location}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <h3 className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-400">
              <CalendarClock className="h-4 w-4" /> Jadwal Terpakai
            </h3>
            <div data-testid="item-schedule" className="mt-4 space-y-3">
              {item.schedule?.length ? item.schedule.map((s) => (
                <div key={s.booking_id} className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{fmt(s.start_time)} — {fmt(s.end_time)}</p>
                    <p className="text-xs text-zinc-500">{s.user_name} · #{s.code}</p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              )) : <p className="text-sm text-zinc-500">Belum ada jadwal. Barang bebas dipinjam.</p>}
            </div>
          </div>
        </div>

        <form onSubmit={submit} data-testid="booking-form"
          className="h-fit space-y-6 rounded-2xl border border-white/10 bg-zinc-900 p-6 lg:sticky lg:top-28">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Booking Barang</h2>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Tanggal</Label>
            <Input data-testid="booking-date-input" type="date" value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Mulai</Label>
              <Input data-testid="booking-start-input" type="time" value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
                className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Selesai</Label>
              <Input data-testid="booking-end-input" type="time" value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
                className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Keperluan</Label>
            <Textarea data-testid="booking-purpose-input" value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })} required
              placeholder="Shooting konten, meeting klien…"
              className="min-h-24 rounded-xl border-white/10 bg-zinc-950 text-base" />
          </div>

          <Button data-testid="submit-booking-button" type="submit" disabled={saving || item.status === "MAINTENANCE"}
            className="h-14 w-full rounded-full bg-[#007AFF] text-base font-semibold text-white hover:bg-[#0069DB]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Booking Sekarang"}
          </Button>
          {item.status === "MAINTENANCE" && (
            <p className="text-sm text-rose-400">Barang sedang maintenance dan tidak bisa dibooking.</p>
          )}
        </form>
      </div>
    </div>
  );
}
