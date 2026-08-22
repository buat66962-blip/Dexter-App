import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { errMsg } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", whatsapp_number: "" });
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register(form);
      toast.success("Berhasil masuk");
      navigate("/");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="flex min-h-screen bg-[#09090B] text-zinc-100">
      <div className="hidden flex-1 flex-col justify-between p-14 lg:flex" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, rgba(0,122,255,0.18), transparent 55%)" }}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#007AFF]">
            <Boxes className="h-5 w-5 text-white" />
          </span>
          <span className="font-heading text-xl font-bold">Gudang Kantor</span>
        </div>
        <div className="max-w-lg">
          <h1 className="font-heading text-4xl font-bold tracking-tighter sm:text-5xl lg:text-6xl">
            Pinjam barang kantor semudah booking hotel.
          </h1>
          <p className="mt-6 text-base leading-relaxed text-zinc-400">
            Booking → Admin approve → Kode pintu gudang otomatis dikirim → Ambil barang → Kembalikan.
          </p>
        </div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">Smart Warehouse Access</p>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-[520px] lg:border-l lg:border-white/10">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="auth-form">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {mode === "login" ? "Masuk" : "Daftar Akun"}
            </h2>
            <p className="mt-2 text-sm text-zinc-500">Gunakan email kantor kamu.</p>
          </div>

          {mode === "register" && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Nama</Label>
              <Input data-testid="register-name-input" value={form.name} onChange={set("name")} required
                className="h-12 rounded-xl border-white/10 bg-zinc-900 text-base" placeholder="Nama lengkap" />
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Email</Label>
            <Input data-testid="login-email-input" type="email" value={form.email} onChange={set("email")} required
              className="h-12 rounded-xl border-white/10 bg-zinc-900 text-base" placeholder="nama@kantor.id" />
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">Password</Label>
            <Input data-testid="login-password-input" type="password" value={form.password} onChange={set("password")} required
              className="h-12 rounded-xl border-white/10 bg-zinc-900 text-base" placeholder="••••••••" />
          </div>

          {mode === "register" && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.2em] text-zinc-400">No. WhatsApp (opsional)</Label>
              <Input data-testid="register-whatsapp-input" value={form.whatsapp_number} onChange={set("whatsapp_number")}
                className="h-12 rounded-xl border-white/10 bg-zinc-900 text-base" placeholder="628xxxxxxxxxx" />
            </div>
          )}

          <Button data-testid="auth-submit-button" type="submit" disabled={loading}
            className="h-12 w-full rounded-full bg-[#007AFF] text-base font-semibold text-white hover:bg-[#0069DB]">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "login" ? "Masuk" : "Daftar"}
          </Button>

          <button type="button" data-testid="toggle-auth-mode"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="w-full text-sm text-zinc-500 hover:text-zinc-300">
            {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
