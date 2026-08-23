import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Minus, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import { useCart } from "@/context/CartContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const JAM = ["2", "4", "6", "8", "10", "12"];

export default function Catalog() {
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const { setQty, qtyOf, totalQty, addLines, window: win, setWindow } = useCart();

  const windowParams = useMemo(() => {
    if (!win.pickup_date) return null;
    const start = `${win.pickup_date}T08:00:00+07:00`;
    const end = win.duration_type === "days"
      ? (win.return_date ? `${win.return_date}T17:00:00+07:00` : null)
      : new Date(new Date(start).getTime() + (win.duration_hours || 8) * 3600000).toISOString();
    return end ? { start_time: start, end_time: end } : null;
  }, [win]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/items", { params: { q, ...(windowParams || {}) } });
      setItems(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [q, windowParams]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api.get("/templates").then(({ data }) => setTemplates(data)).catch(() => {});
  }, []);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const shown = category ? items.filter((i) => i.category === category) : items;
  const grouped = useMemo(() => {
    const g = {};
    shown.forEach((i) => { (g[i.category] = g[i.category] || []).push(i); });
    return g;
  }, [shown]);

  const pakaiPaket = (t) => {
    addLines(t.lines);
    toast.success(`Paket "${t.name}" masuk keranjang`);
  };

  const hapusPaket = async (t) => {
    try {
      await api.delete(`/templates/${t.id}`);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      toast.success("Paket dihapus");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-10 pb-24">
      <div className="max-w-2xl">
        <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Pesan Alat</h1>
        <p className="mt-4 text-base leading-relaxed text-zinc-400">
          Pilih tanggal dulu untuk melihat sisa stok, lalu masukkan alat ke pesanan.
        </p>
      </div>

      <div data-testid="availability-filter" className="grid gap-4 rounded-2xl border border-white/10 bg-zinc-900 p-6 sm:grid-cols-3">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Tanggal Pengambilan</Label>
          <Input data-testid="catalog-pickup-date" type="date" value={win.pickup_date || ""}
            onChange={(e) => setWindow({ pickup_date: e.target.value })}
            className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Durasi</Label>
          <Select value={win.duration_type}
            onValueChange={(v) => setWindow({ duration_type: v })}>
            <SelectTrigger data-testid="catalog-duration-type" className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-zinc-900 text-zinc-100">
              <SelectItem value="hours">Hitungan jam</SelectItem>
              <SelectItem value="days">Hitungan hari</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          {win.duration_type === "days" ? (
            <>
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Tanggal Pengembalian</Label>
              <Input data-testid="catalog-return-date" type="date" value={win.return_date || ""}
                min={win.pickup_date || undefined}
                onChange={(e) => setWindow({ return_date: e.target.value })}
                className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base" />
            </>
          ) : (
            <>
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Lama (jam)</Label>
              <Select value={String(win.duration_hours || 8)}
                onValueChange={(v) => setWindow({ duration_hours: Number(v) })}>
                <SelectTrigger data-testid="catalog-duration-hours" className="h-12 rounded-xl border-white/10 bg-zinc-950 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-zinc-900 text-zinc-100">
                  {JAM.map((h) => <SelectItem key={h} value={h}>{h} jam</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
        <p className="text-sm text-zinc-500 sm:col-span-3">
          {windowParams
            ? "Menampilkan sisa stok untuk waktu tersebut."
            : "Belum pilih tanggal — angka yang tampil adalah stok total."}
        </p>
      </div>

      {templates.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-400">Template Paket</h2>
          <div data-testid="template-list" className="flex flex-wrap gap-3">
            {templates.map((t) => (
              <div key={t.id} data-testid={`template-chip-${t.id}`}
                className="group flex items-center gap-3 rounded-full border border-white/10 bg-zinc-900 pl-5 pr-2 py-2 transition-colors duration-200 hover:border-[#007AFF]/50">
                <button data-testid={`use-template-${t.id}`} onClick={() => pakaiPaket(t)} className="flex items-center gap-2 text-sm">
                  <Bookmark className="h-4 w-4 text-[#007AFF]" />
                  <span className="font-medium">{t.name}</span>
                  <span className="font-mono text-xs text-zinc-500">
                    {t.lines.reduce((s, l) => s + l.qty, 0)} pcs
                  </span>
                </button>
                <button data-testid={`delete-template-${t.id}`} onClick={() => hapusPaket(t)}
                  className="rounded-full p-2 text-zinc-600 hover:bg-white/10 hover:text-rose-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
        <Input
          data-testid="search-inventory-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari kamera, lensa, mic, kabel…"
          className="h-14 rounded-full border-white/10 bg-zinc-900 pl-14 text-base"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button data-testid="filter-all" onClick={() => setCategory("")}
          className={`rounded-full border px-4 py-2 text-sm transition-colors duration-200 ${!category ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>
          Semua
        </button>
        {categories.map((c) => (
          <button key={c} data-testid={`filter-${c.toLowerCase().replace(/[^a-z0-9]/g, "-")}`} onClick={() => setCategory(c)}
            className={`rounded-full border px-4 py-2 text-sm transition-colors duration-200 ${category === c ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Memuat alat…</p>
      ) : (
        <div className="space-y-12">
          {Object.entries(grouped).map(([cat, list]) => (
            <section key={cat} data-testid={`category-section-${cat.toLowerCase().replace(/[^a-z0-9]/g, "-")}`} className="space-y-5">
              <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-400">{cat}</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((item, idx) => {
                  const qty = qtyOf(item.id);
                  const sisa = item.available_qty;
                  const habis = item.status === "MAINTENANCE" || sisa === 0;
                  return (
                    <motion.div key={item.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03, duration: 0.3 }}
                      data-testid={`item-card-${item.item_code}`}
                      className={`flex gap-4 rounded-2xl border p-4 transition-colors duration-200 ${qty > 0 ? "border-[#007AFF]/50 bg-[#007AFF]/5" : "border-white/10 bg-zinc-900 hover:border-white/20"}`}>
                      <Link to={`/barang/${item.id}`} className="shrink-0">
                        <img src={item.photo} alt={item.name} className="h-20 w-20 rounded-xl object-cover" />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <Link to={`/barang/${item.id}`} className="block">
                          <h3 className="truncate font-heading text-lg font-medium tracking-tight">{item.name}</h3>
                          <p className="mt-1 font-mono text-xs text-zinc-500">{item.item_code}</p>
                          <p data-testid={`stock-${item.item_code}`} className="mt-1 text-xs">
                            {windowParams ? (
                              <span className={sisa === 0 ? "text-rose-400" : sisa <= 2 ? "text-amber-400" : "text-emerald-400"}>
                                sisa {sisa} / {item.quantity} pcs
                              </span>
                            ) : (
                              <span className="text-zinc-500">stok {item.quantity} pcs</span>
                            )}
                          </p>
                        </Link>
                        <div className="mt-3 flex items-center gap-3">
                          {habis ? (
                            <span className="text-xs text-zinc-500">
                              {item.status === "MAINTENANCE" ? "Maintenance" : "Sudah dipesan penuh"}
                            </span>
                          ) : qty === 0 ? (
                            <button data-testid={`add-item-${item.item_code}`} onClick={() => setQty(item, 1)}
                              className="rounded-full bg-[#007AFF] px-5 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#0069DB]">
                              Tambah
                            </button>
                          ) : (
                            <div className="flex items-center gap-3 rounded-full border border-white/10 px-2 py-1">
                              <button data-testid={`dec-item-${item.item_code}`} onClick={() => setQty(item, qty - 1)}
                                className="rounded-full p-2 text-zinc-300 hover:bg-white/10">
                                <Minus className="h-4 w-4" />
                              </button>
                              <span data-testid={`qty-${item.item_code}`} className="min-w-6 text-center font-mono text-sm">{qty}</span>
                              <button data-testid={`inc-item-${item.item_code}`} disabled={qty >= (windowParams ? sisa : item.quantity)}
                                onClick={() => setQty(item, Math.min(windowParams ? sisa : item.quantity, qty + 1))}
                                className="rounded-full p-2 text-zinc-300 hover:bg-white/10 disabled:opacity-30">
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          ))}
          {shown.length === 0 && <p className="text-sm text-zinc-500">Alat tidak ditemukan.</p>}
        </div>
      )}

      {totalQty > 0 && (
        <Link to="/checkout" data-testid="go-to-checkout-button"
          className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-[#007AFF] px-7 py-4 text-base font-semibold text-white shadow-2xl transition-transform duration-200 hover:-translate-y-0.5 md:bottom-8">
          <ShoppingBag className="h-5 w-5" />
          Lanjut Pesan · {totalQty} pcs
        </Link>
      )}
    </div>
  );
}
