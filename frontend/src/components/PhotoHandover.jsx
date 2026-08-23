import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/api";

const AuthImage = ({ path, onRemove, testId }) => {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let url;
    let alive = true;
    api.get(`/files/${path}`, { responseType: "blob" })
      .then(({ data }) => {
        if (!alive) return;
        url = URL.createObjectURL(data);
        setSrc(url);
      })
      .catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [path]);

  return (
    <div data-testid={testId} className="relative h-24 w-24 overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
      {src ? <img src={src} alt="bukti" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">…</div>}
      {onRemove && (
        <button onClick={onRemove} data-testid={`${testId}-remove`}
          className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-zinc-300 hover:text-rose-400">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

export const PhotoHandover = ({ bookingId, phase, photos, locked, lockedText, onSaved }) => {
  const [list, setList] = useState(photos || []);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { setList(photos || []); }, [photos]);

  const upload = async (files) => {
    setBusy(true);
    try {
      const uploaded = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const fd = new FormData();
        fd.append("file", file);
        const { data } = await api.post("/uploads", fd, { headers: { "Content-Type": "multipart/form-data" } });
        uploaded.push(data.path);
      }
      const next = [...list, ...uploaded];
      const { data } = await api.post(`/bookings/${bookingId}/handover`, { phase, photos: next });
      setList(next);
      toast.success("Foto tersimpan");
      onSaved?.(data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (path) => {
    const next = list.filter((p) => p !== path);
    try {
      const { data } = await api.post(`/bookings/${bookingId}/handover`, { phase, photos: next });
      setList(next);
      onSaved?.(data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div data-testid={`handover-${phase}`} className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-heading text-xl font-semibold tracking-tight">
            <Camera className="h-4 w-4 text-[#007AFF]" />
            {phase === "pickup" ? "Foto Saat Ambil" : "Foto Saat Kembali"}
          </h3>
          <p className="mt-2 text-sm text-zinc-500">
            {locked ? lockedText : "Foto kondisi alat sebagai bukti serah terima (maks 5 foto)."}
          </p>
        </div>
        {!locked && (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden
              data-testid={`upload-input-${phase}`}
              onChange={(e) => e.target.files?.length && upload(e.target.files)} />
            <button data-testid={`upload-button-${phase}`} disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-full bg-[#007AFF] px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#0069DB] disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Unggah Foto
            </button>
          </>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {list.map((p) => (
          <AuthImage key={p} path={p} testId={`photo-${phase}-${p.split("/").pop()}`}
            onRemove={locked ? null : () => remove(p)} />
        ))}
        {list.length === 0 && <p className="text-sm text-zinc-600">Belum ada foto.</p>}
      </div>
    </div>
  );
};

export default PhotoHandover;
