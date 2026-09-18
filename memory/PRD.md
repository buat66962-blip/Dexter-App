# Dexter — Sistem Peminjaman Alat Kantor (internal)

## Problem statement
Sistem peminjaman alat/inventaris kantor bergaya "GoFood": user pilih banyak alat + qty ke keranjang,
pilih tanggal & jam ambil/kembali, checkout. Approval admin lewat Telegram (inline button).
Setelah approve: kode akses pintu (MOCK BARDI/Tuya), event Google Calendar, invoice + checklist.
Serah terima wajib foto (ambil & kembali). Template paket alat editable per user.
Admin CRUD kategori & barang di tab Inventaris. WhatsApp DIHAPUS permanen.

Bahasa user: Indonesia. Produksi: https://warehouse-rental-5.emergent.host

## Arsitektur
- backend/: FastAPI + MongoDB (server.py, core.py, services.py, storage.py, providers.py)
- frontend/: React + Tailwind + Shadcn (pages: Login, Catalog, Checkout, BookingDetail, MyBookings, Admin, Templates)
- Auth: JWT via cookie httpOnly

## Sudah diimplementasi
- Keranjang multi-item + cek stok live berdasarkan overlap waktu
- Approval Telegram, Google Calendar (service account), foto serah terima (object storage)
- Template paket: CRUD, tombol "Buat Paket Baru" & "Duplikat", paket shared bisa diedit semua user
- Admin CRUD kategori & barang; rebranding "Dexter"/"Storage"
- Landing page copy baru (headline EN + flow + footer "DEXTER • GEAR & MAINTENANCE TRACKER")
- 2026-06: **Pemilihan jam** pengambilan & pengembalian di Checkout (default 08:00/17:00),
  start/end booking dihitung dari tanggal+jam WIB. **Dua kode pintu berbeda** per booking
  (kind PICKUP & RETURN) dibuat saat approve; masing-masing baru dibuka/dikirim 1 jam
  sebelum jadwalnya (`release_at`, `release_due_access_codes()` di scheduler).
  API booking mengembalikan `access_codes[]` (code=null selama belum rilis).

## Backlog
- P1: Integrasi asli BARDI/Tuya (masih MOCK)
- P2: Riwayat alat per unit
- P3: Telegram Mini App admin, analitik lanjutan
