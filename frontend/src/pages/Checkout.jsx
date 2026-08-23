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

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Checkout() {
  const { lines, setQty, clear, totalQty } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ pickup_date: "", return_date: "", purpose: "", location: "" });
  const [stock, setStock] = useState({});
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [shared, setShared] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const grouped = useMemo(() => {
    const g = {};
    lines.forEach((l) => { (g[l.category] = g[l.category] || []).push(l); });
    return g;
  }, [lines]);

  useEffect(() => {
    if (!form.pickup_date || !form.return_date) { setStock({}); return; }
    api.get("/items", {
      params: {
        start_time: `${form.pickup_date}T08:00:00+07:00`,
        end_time: `${form.return_date}T17:00:00+07:00`,
      },
    }).then(({ data }) => {
      const map = {};
      data.forEach((i) => { map[i.id] = i.available_qty; });
      setStock(map);
    }).catch(() => {});
  }, [form.pickup_date, form.return_date]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.pickup_date) return toast.error("Pilih tanggal pengambilan");
    if (!form.return_date) return toast.error("Pilih tanggal pengembalian");
    if (!lines.length) return toast.error("Keranjang kosong");
    setSaving(true);
    try {
      const { data } = await api.post("/bookings", {
        lines: lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
        pickup_date: form.pickup_date,
        return_date: form.return_date,
        purpose: form.purpose,
        location: form.location,
      });
      clear();
      toast.success("Booking dibuat, menunggu approval admin");
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

  const dateSet = form.pickup_date && form.return_date;

  return (
    <div className="space-y-8">
      <button data-testid="back-button" onClick={() => navigate("/")}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Tambah alat lagi
      </button>

      <div>
        <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Konfirmasi Booking</h1>
        <p className="mt-4 text-base text-zinc-400">Tentukan tanggal pengambilan dan pengembalian, lalu kirim booking.</p>
      </div>

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
              <Input data-testid="checkout-date-input" type="date" value={form.pickup_date} min={todayStr()}
                onChange={(e) => setForm({
                  ...form,
                  pickup_date: e.target.value,
                  return_date: form.return_date && form.return_date < e.target.value ? e.target.value : form.return_date,
                })}
                className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Tanggal Pengembalian</Label>
              <Input data-testid="checkout-return-date-input" type="date" value={form.return_date}
                min={form.pickup_date || todayStr()}
                onChange={(e) => setForm({ ...form, return_date: e.target.value })}
                className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
            </div>
          </div>

          <p data-testid="return-date-preview" className="text-sm text-zinc-500">
            {dateSet
              ? `Ambil ${form.pickup_date} · kembali ${form.return_date} — checklist pengembalian terbuka pada tanggal pengembalian`
              : "Pilih kedua tanggal untuk melihat sisa stok."}
          </p>

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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Kirim Booking · ${totalQty} pcs`}
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
              {list.map((l) => {
                const sisa = stock[l.item_id];
                const kurang = dateSet && sisa !== undefined && l.qty > sisa;
                return (
                  <div key={l.item_id} data-testid={`cart-line-${l.item_code}`}
                    className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 ${kurang ? "bg-rose-500/10 ring-1 ring-rose-500/40" : "bg-zinc-950/60"}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{l.name}</p>
                      <p data-testid={`cart-stock-${l.item_code}`} className="font-mono text-xs text-zinc-500">
                        {l.item_code}
                        {dateSet && sisa !== undefined && (
                          <span className={kurang ? " text-rose-400" : sisa <= 2 ? " text-amber-400" : " text-emerald-400"}>
                            {" "}· sisa {sisa} pcs
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button data-testid={`cart-dec-${l.item_code}`} onClick={() => setQty({ ...l, id: l.item_id, quantity: l.max }, l.qty - 1)}
                        className="rounded-full p-2 text-zinc-400 hover:bg-white/10"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="min-w-10 text-center font-mono text-sm">{l.qty} pcs</span>
                      <button data-testid={`cart-inc-${l.item_code}`}
                        disabled={dateSet && sisa !== undefined ? l.qty >= sisa : (l.max ? l.qty >= l.max : false)}
                        onClick={() => setQty({ ...l, id: l.item_id, quantity: l.max }, l.qty + 1)}
                        className="rounded-full p-2 text-zinc-400 hover:bg-white/10 disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
