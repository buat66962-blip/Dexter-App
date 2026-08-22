const MAP = {
  AVAILABLE: { label: "Tersedia", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  BOOKED: { label: "Dibooking", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  BORROWED: { label: "Dipinjam", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  MAINTENANCE: { label: "Maintenance", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30" },
  OVERDUE: { label: "Terlambat", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
  PENDING: { label: "Menunggu Approval", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  APPROVED: { label: "Disetujui", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  REJECTED: { label: "Ditolak", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
  CANCELLED: { label: "Dibatalkan", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30" },
  RETURN_REQUESTED: { label: "Menunggu Konfirmasi", cls: "bg-sky-500/10 text-sky-400 border-sky-500/30" },
  RETURNED: { label: "Selesai", cls: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30" },
  ACTIVE: { label: "Aktif", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  EXPIRED: { label: "Kedaluwarsa", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30" },
  FAILED: { label: "Gagal", cls: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
};

export const StatusBadge = ({ status, testId }) => {
  const s = MAP[status] || { label: status, cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30" };
  return (
    <span
      data-testid={testId || `status-${String(status).toLowerCase()}`}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${s.cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
};

export default StatusBadge;
