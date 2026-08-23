# Dexter — Sistem Peminjaman Alat Kantor (internal)

## Problem statement
Sistem peminjaman alat/inventaris kantor bergaya "GoFood": user pilih banyak alat + qty ke keranjang,
pilih tanggal ambil & kembali, checkout. Approval admin lewat Telegram (inline button).
Setelah approve: kode akses pintu (MOCK BARDI/Tuya), event Google Calendar, invoice + checklist.
Serah terima wajib foto (ambil & kembali). Template paket alat editable per user.
Admin CRUD kategori & barang di tab Inventaris. WhatsApp DIHAPUS permanen.

Bahasa user: Indonesia.

## Arsitektur
- backend/: FastAPI + MongoDB (server.py, core.py, services.py, storage.py, providers.py)
- frontend/: React + Tailwind + Shadcn (pages: Login, Catalog, Checkout, BookingDetail, MyBookings, Admin, Templates)
- Auth: JWT via cookie httpOnly (login mengembalikan user, token di cookie)

## Sudah diimplementasi
- Keranjang multi-item + cek stok live berdasarkan overlap tanggal
- Approval Telegram (webhook + inline callback)
- Google Calendar via service account (GOOGLE_SERVICE_ACCOUNT_JSON base64)
- Foto serah terima via Emergent Object Storage
- Template paket (CRUD), Admin CRUD kategori & barang
- Rebranding "Dexter", istilah "Storage", tab Pengaturan & Notifikasi dihapus
- 2026-06 (sesi ini): Halaman Paket kini punya tombol **Buat Paket Baru** (bikin paket tanpa lewat keranjang),
  tombol **Duplikat** di setiap paket, dan paket bertanda "dibagikan" bisa diedit semua user
  (backend PUT /api/templates/{id} mengizinkan owner, admin, atau template shared). Hapus tetap owner/admin.

## Backlog
- P1: Integrasi asli BARDI/Tuya (masih MOCK, kredensial belum ada)
- P2: Reminder bertingkat sebelum ambil/kembali
- P3: Telegram Mini App admin
- P3: Analitik & laporan lanjutan
