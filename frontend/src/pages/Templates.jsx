import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, Minus, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addItemId, setAddItemId] = useState("");
  const { addLines } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const load = () => api.get("/templates").then(({ data }) => setTemplates(data)).catch((e) => toast.error(errMsg(e)));

  useEffect(() => {
    load();
    api.get("/items").then(({ data }) => setItems(data)).catch(() => {});
  }, []);

  const canEdit = (t) => t.owner_id === user?.id || user?.role === "admin";
  const grouped = useMemo(() => {
    const g = {};
    (editing?.lines || []).forEach((l) => { (g[l.category || "Lainnya"] = g[l.category || "Lainnya"] || []).push(l); });
    return g;
  }, [editing]);

  const setLineQty = (itemId, qty) =>
    setEditing((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.item_id === itemId ? { ...l, qty: Math.max(1, qty) } : l)),
    }));

  const removeLine = (itemId) =>
    setEditing((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.item_id !== itemId) }));

  const addLine = () => {
    const item = items.find((i) => i.id === addItemId);
    if (!item) return;
    if (editing.lines.some((l) => l.item_id === item.id)) return toast.error("Alat sudah ada di paket");
    setEditing((prev) => ({
      ...prev,
      lines: [...prev.lines, {
        item_id: item.id, name: item.name, item_code: item.item_code,
        category: item.category, qty: 1, photo: item.photo, max: item.quantity,
      }],
    }));
    setAddItemId("");
  };

  const save = async () => {
    if (!editing.lines.length) return toast.error("Paket harus punya minimal satu alat");
    setBusy(true);
    try {
      await api.put(`/templates/${editing.id}`, {
        name: editing.name,
        is_shared: editing.is_shared,
        lines: editing.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
      });
      toast.success("Paket diperbarui");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const hapus = async (t) => {
    try {
      await api.delete(`/templates/${t.id}`);
      toast.success("Paket dihapus");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Template Paket</h1>
        <p className="mt-4 text-base text-zinc-400">
          Simpan kombinasi alat favorit, edit kapan saja, dan pakai sekali klik saat booking.
        </p>
      </div>

      <div data-testid="templates-page-list" className="grid gap-4 md:grid-cols-2">
        {templates.map((t) => (
          <div key={t.id} data-testid={`template-card-${t.id}`}
            className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-heading text-xl font-semibold tracking-tight">
                  <Bookmark className="h-4 w-4 text-[#007AFF]" /> {t.name}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {t.lines.length} jenis · {t.lines.reduce((s, l) => s + l.qty, 0)} pcs · milik {t.owner_name}
                  {t.is_shared ? " · dibagikan" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {canEdit(t) && (
                  <>
                    <button data-testid={`edit-template-${t.id}`} onClick={() => setEditing({ ...t, lines: [...t.lines] })}
                      className="rounded-full p-2 text-zinc-400 hover:bg-white/10 hover:text-white">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button data-testid={`delete-template-${t.id}`} onClick={() => hapus(t)}
                      className="rounded-full p-2 text-zinc-500 hover:bg-white/10 hover:text-rose-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              {t.lines.map((l) => (
                <div key={l.item_id} className="flex justify-between rounded-xl bg-zinc-950/60 px-4 py-2 text-sm">
                  <span className="truncate">{l.name}</span>
                  <span className="font-mono text-xs text-zinc-500">{l.qty} pcs</span>
                </div>
              ))}
            </div>

            <Button data-testid={`use-template-page-${t.id}`}
              onClick={() => { addLines(t.lines); toast.success("Paket masuk keranjang"); navigate("/checkout"); }}
              className="h-12 w-full rounded-full bg-[#007AFF] font-semibold text-white hover:bg-[#0069DB]">
              Pakai Paket Ini
            </Button>
          </div>
        ))}
        {templates.length === 0 && (
          <p className="text-sm text-zinc-500">
            Belum ada paket. Tambahkan alat ke keranjang, lalu di halaman Konfirmasi Booking pilih "Simpan paket".
          </p>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-white/10 bg-zinc-900 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="font-heading">Edit Paket</DialogTitle>
            <DialogDescription className="text-zinc-500">
              Ubah nama, jumlah tiap alat, tambah atau hapus alat dari paket ini.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Nama Paket</Label>
                <Input data-testid="edit-template-name-input" value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="h-12 rounded-xl border-white/10 bg-zinc-950" />
              </div>

              <label className="flex items-center gap-3 text-sm text-zinc-400">
                <input data-testid="edit-template-shared-checkbox" type="checkbox" checked={!!editing.is_shared}
                  onChange={(e) => setEditing({ ...editing, is_shared: e.target.checked })}
                  className="h-4 w-4 accent-[#007AFF]" />
                Bagikan ke semua orang
              </label>

              <div className="space-y-4">
                {Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat} className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">{cat}</p>
                    {list.map((l) => (
                      <div key={l.item_id} data-testid={`edit-line-${l.item_code}`}
                        className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm">{l.name}</p>
                          <p className="font-mono text-xs text-zinc-500">{l.item_code} · stok {l.max}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button data-testid={`edit-dec-${l.item_code}`} onClick={() => setLineQty(l.item_id, l.qty - 1)}
                            className="rounded-full p-2 text-zinc-400 hover:bg-white/10"><Minus className="h-3.5 w-3.5" /></button>
                          <span className="min-w-10 text-center font-mono text-sm">{l.qty}</span>
                          <button data-testid={`edit-inc-${l.item_code}`} disabled={l.qty >= (l.max || 99)}
                            onClick={() => setLineQty(l.item_id, l.qty + 1)}
                            className="rounded-full p-2 text-zinc-400 hover:bg-white/10 disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
                          <button data-testid={`edit-remove-${l.item_code}`} onClick={() => removeLine(l.item_id)}
                            className="rounded-full p-2 text-zinc-600 hover:bg-white/10 hover:text-rose-400"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Tambah Alat</Label>
                <div className="flex gap-2">
                  <Select value={addItemId} onValueChange={setAddItemId}>
                    <SelectTrigger data-testid="edit-add-item-select" className="h-12 flex-1 rounded-xl border-white/10 bg-zinc-950">
                      <SelectValue placeholder="Pilih alat" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 border-white/10 bg-zinc-900 text-zinc-100">
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name} ({i.quantity} pcs)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button data-testid="edit-add-item-button" onClick={addLine} disabled={!addItemId}
                    className="h-12 rounded-full bg-white/10 px-5 font-semibold text-white hover:bg-white/20">
                    Tambah
                  </Button>
                </div>
              </div>

              <Button data-testid="save-template-edit-button" onClick={save} disabled={busy}
                className="h-12 w-full rounded-full bg-[#007AFF] font-semibold text-white hover:bg-[#0069DB]">
                Simpan Perubahan
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
