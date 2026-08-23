import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DURASI = [
  { value: "4", label: "4 jam" },
  { value: "8", label: "8 jam (1 hari kerja)" },
  { value: "24", label: "1 hari" },
  { value: "48", label: "2 hari" },
  { value: "72", label: "3 hari" },
  { value: "168", label: "7 hari" },
];

export default function Checkout() {
  const { lines, setQty, clear, totalQty } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ date: "", time: "09:00", duration: "8", purpose: "", location: "" });
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    const g = {};
    lines.forEach((l) => { (g[l.category] = g[l.category] || []).push(l); });
    return g;
  }, [lines]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.date) return toast.error("Pilih tanggal pengambilan");
    if (!lines.length) return toast.error("Keranjang kosong");
    setSaving(true);
    try {
      const { data } = await api.post("/bookings", {
        lines: lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
        pickup_date: form.date,
        pickup_time: form.time,
        duration_hours: Number(form.duration),
        purpose: form.purpose,
        location: form.location,
      });
      clear();
      toast.success("Order dibuat, menunggu approval admin");
      navigate(`/peminjaman/${data.id}`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <button data-testid="back-button" onClick={() => navigate("/")}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Tambah alat lagi
      </button>

      <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Detail Pesanan</h1>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <form onSubmit={submit} data-testid="checkout-form"
          className="h-fit space-y-6 rounded-2xl border border-white/10 bg-zinc-900 p-6">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Nama</Label>
            <Input data-testid="checkout-name-input" value={user?.name || ""} readOnly
              className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base text-zinc-400" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Tanggal Pengambilan</Label>
              <Input data-testid="checkout-date-input" type="date" value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Jam Pengambilan</Label>
              <Input data-testid="checkout-time-input" type="time" value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Durasi Peminjaman</Label>
            <Select value={form.duration} onValueChange={(v) => setForm({ ...form, duration: v })}>
              <SelectTrigger data-testid="checkout-duration-select" className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-zinc-900 text-zinc-100">
                {DURASI.map((d) => (
                  <SelectItem key={d.value} value={d.value} data-testid={`duration-option-${d.value}`}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Acara</Label>
            <Input data-testid="checkout-event-input" value={form.purpose} required
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              placeholder="Shooting konten, live event…"
              className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Lokasi</Label>
            <Textarea data-testid="checkout-location-input" value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="Studio YN, Gedung A lantai 3…"
              className="min-h-20 rounded-xl border-white/10 bg-zinc-950 text-base" />
          </div>

          <Button data-testid="submit-order-button" type="submit" disabled={saving || !lines.length}
            className="h-14 w-full rounded-full bg-[#007AFF] text-base font-semibold text-white hover:bg-[#0069DB]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Kirim Order · ${totalQty} pcs`}
          </Button>
        </form>

        <div data-testid="cart-summary" className="h-fit space-y-6 rounded-2xl border border-white/10 bg-zinc-900 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">List Alat</h2>
            {lines.length > 0 && (
              <button data-testid="clear-cart-button" onClick={clear}
                className="flex items-center gap-2 text-sm text-zinc-500 hover:text-rose-400">
                <Trash2 className="h-4 w-4" /> Kosongkan
              </button>
            )}
          </div>

          {lines.length === 0 && <p className="text-sm text-zinc-500">Belum ada alat. Kembali ke katalog untuk menambah.</p>}

          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} className="space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">{cat}</p>
              {list.map((l) => (
                <div key={l.item_id} data-testid={`cart-line-${l.item_code}`}
                  className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="font-mono text-xs text-zinc-500">{l.item_code}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button data-testid={`cart-dec-${l.item_code}`} onClick={() => setQty({ ...l, id: l.item_id, quantity: l.max }, l.qty - 1)}
                      className="rounded-full p-2 text-zinc-400 hover:bg-white/10"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="min-w-10 text-center font-mono text-sm">{l.qty} pcs</span>
                    <button data-testid={`cart-inc-${l.item_code}`} disabled={l.max ? l.qty >= l.max : false}
                      onClick={() => setQty({ ...l, id: l.item_id, quantity: l.max }, l.qty + 1)}
                      className="rounded-full p-2 text-zinc-400 hover:bg-white/10 disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
