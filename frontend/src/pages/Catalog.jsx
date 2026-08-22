import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { motion } from "framer-motion";
import { api, errMsg } from "@/api";
import StatusBadge from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function Catalog() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/items", { params: { q } });
        setItems(data);
      } catch (e) {
        toast.error(errMsg(e));
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const shown = category ? items.filter((i) => i.category === category) : items;

  return (
    <div className="space-y-10">
      <div className="max-w-2xl">
        <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Cari Barang</h1>
        <p className="mt-4 text-base leading-relaxed text-zinc-400">
          Pilih barang, tentukan waktu, lalu booking. Admin approve dan kode pintu gudang langsung dikirim.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
        <Input
          data-testid="search-inventory-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari kamera, laptop, proyektor…"
          className="h-14 rounded-full border-white/10 bg-zinc-900 pl-14 text-base"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button data-testid="filter-all" onClick={() => setCategory("")}
          className={`rounded-full border px-4 py-2 text-sm transition-colors duration-200 ${!category ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>
          Semua
        </button>
        {categories.map((c) => (
          <button key={c} data-testid={`filter-${c.toLowerCase()}`} onClick={() => setCategory(c)}
            className={`rounded-full border px-4 py-2 text-sm transition-colors duration-200 ${category === c ? "border-white/20 bg-white/10 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`}>
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Memuat barang…</p>
      ) : (
        <div data-testid="items-grid" className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((item, idx) => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05, duration: 0.35 }}>
              <Link to={`/barang/${item.id}`} data-testid={`item-card-${item.item_code}`}
                className="group block overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-white/20">
                <div className="aspect-[4/3] overflow-hidden bg-zinc-800">
                  <img src={item.photo} alt={item.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                </div>
                <div className="space-y-3 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-heading text-xl font-medium tracking-tight">{item.name}</h3>
                  </div>
                  <p className="font-mono text-xs text-zinc-500">{item.item_code} · {item.category}</p>
                  <StatusBadge status={item.status} testId={`item-status-${item.item_code}`} />
                </div>
              </Link>
            </motion.div>
          ))}
          {shown.length === 0 && <p className="text-sm text-zinc-500">Barang tidak ditemukan.</p>}
        </div>
      )}
    </div>
  );
}
