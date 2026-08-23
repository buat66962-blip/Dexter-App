import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Minus, Plus, Search, ShoppingBag } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import { useCart } from "@/context/CartContext";
import { Input } from "@/components/ui/input";

export default function Catalog() {
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const { setQty, qtyOf, totalQty, addLines } = useCart();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/items", { params: { q } });
      setItems(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [q]);

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

  return (
    <div className="space-y-10 pb-24">
      <div className="max-w-2xl">
        <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Booking Alat</h1>
        <p className="mt-4 text-base leading-relaxed text-zinc-400">
          Pilih alat dan jumlahnya, lanjut ke konfirmasi booking untuk menentukan tanggal pengambilan & pengembalian.
        </p>
      </div>

      {templates.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-400">Template Paket</h2>
            <Link to="/paket" data-testid="manage-templates-link" className="text-sm text-[#007AFF] hover:underline">
              Kelola paket
            </Link>
          </div>
          <div data-testid="template-list" className="flex flex-wrap gap-3">
            {templates.map((t) => (
              <button key={t.id} data-testid={`use-template-${t.id}`} onClick={() => pakaiPaket(t)}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900 px-5 py-2.5 text-sm transition-colors duration-200 hover:border-[#007AFF]/50">
                <Bookmark className="h-4 w-4 text-[#007AFF]" />
                <span className="font-medium">{t.name}</span>
                <span className="font-mono text-xs text-zinc-500">{t.lines.reduce((s, l) => s + l.qty, 0)} pcs</span>
              </button>
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
                  const maintenance = item.status === "MAINTENANCE";
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
                          <p data-testid={`stock-${item.item_code}`} className="mt-1 text-xs text-zinc-500">
                            stok {item.quantity} pcs
                          </p>
                        </Link>
                        <div className="mt-3 flex items-center gap-3">
                          {maintenance ? (
                            <span className="text-xs text-zinc-500">Maintenance</span>
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
                              <button data-testid={`inc-item-${item.item_code}`} disabled={qty >= item.quantity}
                                onClick={() => setQty(item, Math.min(item.quantity, qty + 1))}
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
          Lanjut Booking · {totalQty} pcs
        </Link>
      )}
    </div>
  );
}
