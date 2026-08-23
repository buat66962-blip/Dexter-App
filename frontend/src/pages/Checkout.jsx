import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bookmark, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const JAM = ["2", "4", "6", "8", "10", "12"];

export default function Checkout() {
  const { lines, setQty, clear, totalQty, window: cartWindow, setWindow } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    pickup_date: cartWindow.pickup_date || "",
    duration_type: cartWindow.duration_type || "hours",
    duration_hours: String(cartWindow.duration_hours || 8),
    return_date: cartWindow.return_date || "",
    purpose: "",
    location: "",
  });
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [shared, setShared] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  useEffect(() => {
    setWindow({
      pickup_date: form.pickup_date,
      duration_type: form.duration_type,
      duration_hours: Number(form.duration_hours),
      return_date: form.duration_type === "days" ? form.return_date : form.pickup_date,
    });
    // eslint-disable-next-line
  }, [form.pickup_date, form.duration_type, form.duration_hours, form.return_date]);

  const grouped = useMemo(() => {
    const g = {};
    lines.forEach((l) => { (g[l.category] = g[l.category] || []).push(l); });
    return g;
  }, [lines]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.pickup_date) return toast.error("Pilih tanggal pengambilan");
    if (form.duration_type === "days" && !form.return_date) return toast.error("Pilih tanggal pengembalian");
    if (!lines.length) return toast.error("Keranjang kosong");
    setSaving(true);
    try {
      const { data } = await api.post("/bookings", {
        lines: lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
        pickup_date: form.pickup_date,
        duration_type: form.duration_type,
        duration_hours: Number(form.duration_hours),
        return_date: form.duration_type === "days" ? form.return_date : null,
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

  const saveTemplate = async () => {
    try {
      await api.post("/templates", {
        name: templateName,
        lines: lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
        is_shared: shared,
      });
      toast.success("Template paket disimpan");
      setTemplateName("");
      setTemplateOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
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

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Tanggal Pengambilan</Label>
            <Input data-testid="checkout-date-input" type="date" value={form.pickup_date}
              onChange={(e) => setForm({ ...form, pickup_date: e.target.value })}
              className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
          </div>

          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Durasi Peminjaman</Label>
            <div className="grid grid-cols-2 gap-2">
              {[["hours", "Hitungan Jam (hari yang sama)"], ["days", "Hitungan Hari (beda hari)"]].map(([v, l]) => (
                <button key={v} type="button" data-testid={`duration-type-${v}`}
                  onClick={() => setForm({ ...form, duration_type: v })}
                  className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors duration-200 ${
                    form.duration_type === v ? "border-[#007AFF] bg-[#007AFF]/10 text-white" : "border-white/10 text-zinc-400 hover:border-white/20"}`}>
                  {l}
                </button>
              ))}
            </div>

            {form.duration_type === "hours" ? (
              <Select value={form.duration_hours} onValueChange={(v) => setForm({ ...form, duration_hours: v })}>
                <SelectTrigger data-testid="checkout-duration-select" className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-zinc-900 text-zinc-100">
                  {JAM.map((h) => (
                    <SelectItem key={h} value={h} data-testid={`duration-option-${h}`}>{h} jam</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Tanggal Pengembalian</Label>
                <Input data-testid="checkout-return-date-input" type="date" value={form.return_date}
                  min={form.pickup_date || undefined}
                  onChange={(e) => setForm({ ...form, return_date: e.target.value })}
                  className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
              </div>
            )}

            <p data-testid="return-date-preview" className="text-sm text-zinc-500">
              Tanggal pengembalian:{" "}
              <span className="text-zinc-300">
                {form.duration_type === "days" ? (form.return_date || "—") : (form.pickup_date || "—")}
              </span>{" "}
              · checklist pengembalian terbuka pada tanggal ini
            </p>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">List Alat</h2>
            <div className="flex items-center gap-3">
              {lines.length > 0 && (
                <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
                  <DialogTrigger asChild>
                    <button data-testid="save-template-button"
                      className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
                      <Bookmark className="h-4 w-4" /> Simpan paket
                    </button>
                  </DialogTrigger>
                  <DialogContent className="border-white/10 bg-zinc-900 text-zinc-100">
                    <DialogHeader>
                      <DialogTitle className="font-heading">Simpan Template Paket</DialogTitle>
                      <DialogDescription className="text-zinc-500">
                        Simpan kombinasi alat ini supaya sekali klik bisa dipakai lagi nanti.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <Input data-testid="template-name-input" value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder="Contoh: Multicam 3 Kamera"
                        className="h-12 rounded-xl border-white/10 bg-zinc-950" />
                      <label className="flex items-center gap-3 text-sm text-zinc-400">
                        <input data-testid="template-shared-checkbox" type="checkbox" checked={shared}
                          onChange={(e) => setShared(e.target.checked)} className="h-4 w-4 accent-[#007AFF]" />
                        Bagikan ke semua orang
                      </label>
                      <Button data-testid="confirm-save-template-button" onClick={saveTemplate}
                        className="h-12 w-full rounded-full bg-[#007AFF] font-semibold text-white hover:bg-[#0069DB]">
                        Simpan
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              {lines.length > 0 && (
                <button data-testid="clear-cart-button" onClick={clear}
                  className="flex items-center gap-2 text-sm text-zinc-500 hover:text-rose-400">
                  <Trash2 className="h-4 w-4" /> Kosongkan
                </button>
              )}
            </div>
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
