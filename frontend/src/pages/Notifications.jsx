import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const fmt = (iso) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Notifications() {
  const [list, setList] = useState([]);
  const { user, reload } = useAuth();
  const [wa, setWa] = useState("");

  const load = () => api.get("/notifications").then(({ data }) => setList(data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => { setWa(user?.whatsapp_number || ""); }, [user]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl">Notifikasi</h1>
        <Button data-testid="mark-all-read-button" variant="outline"
          className="rounded-full border-white/10 bg-transparent text-zinc-300 hover:bg-white/10"
          onClick={async () => { await api.post("/notifications/read-all"); load(); }}>
          Tandai dibaca
        </Button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
        <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Nomor WhatsApp untuk notifikasi</Label>
        <div className="mt-3 flex flex-wrap gap-3">
          <Input data-testid="whatsapp-number-input" value={wa} onChange={(e) => setWa(e.target.value)}
            placeholder="628xxxxxxxxxx" className="h-12 max-w-xs rounded-xl border-white/10 bg-zinc-950" />
          <Button data-testid="save-whatsapp-button"
            onClick={async () => {
              try {
                await api.put("/me/profile", { whatsapp_number: wa });
                await reload();
                toast.success("Nomor WhatsApp disimpan");
              } catch (e) { toast.error(errMsg(e)); }
            }}
            className="h-12 rounded-full bg-[#007AFF] px-6 font-semibold text-white hover:bg-[#0069DB]">
            Simpan
          </Button>
        </div>
        <p className="mt-3 text-sm text-zinc-500">
          Kode akses gudang dan pengingat pengembalian akan dikirim ke nomor ini.
        </p>
      </div>

      <div data-testid="notifications-list" className="space-y-3">
        {list.map((n) => (
          <div key={n.id} data-testid={`notification-${n.id}`}
            className={`flex gap-4 rounded-2xl border p-5 ${n.read ? "border-white/10 bg-zinc-900" : "border-[#007AFF]/40 bg-[#007AFF]/5"}`}>
            <Bell className="mt-1 h-4 w-4 shrink-0 text-[#007AFF]" />
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{n.type}</p>
              <p className="mt-2 whitespace-pre-line text-base text-zinc-200">{n.text}</p>
              <p className="mt-2 text-xs text-zinc-600">{fmt(n.sent_at)}</p>
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-zinc-500">Belum ada notifikasi.</p>}
      </div>
    </div>
  );
}
