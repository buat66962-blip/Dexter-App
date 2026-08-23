# PRD — Office Inventory Rental & Smart Warehouse System ("Gudang Kantor")

## Problem Statement (asal)
Aplikasi internal kantor yang berfungsi seperti sistem rental barang untuk inventaris kantor.
Core loop: **BOOK → APPROVE → ACCESS → TAKE → USE → RETURN**. Sesederhana mungkin, bukan ERP.
Integrasi: Telegram (admin UI utama), WhatsApp (notifikasi admin), Google Calendar (time blocking),
BARDI/Tuya smart door lock (kode akses temporer). UI Bahasa Indonesia, tema dark.

## Arsitektur
- Backend FastAPI (`/app/backend`): `core.py` (Mongo + serializer + audit), `auth.py` (JWT httpOnly cookie, RBAC, seeding, brute-force), `providers.py` (abstraction: DoorProvider Tuya/Simulated, Telegram, WhatsApp, Calendar), `services.py` (lifecycle booking + notification engine + scheduler), `server.py` (routes /api + Telegram webhook).
- Frontend React + Tailwind + shadcn (`/app/frontend/src`): pages Login, Catalog, ItemDetail, MyBookings, BookingDetail, Notifications, Admin.
- MongoDB collections: users, items, bookings, doors, access_credentials, calendar_events, notifications, access_logs, audit_logs, settings, login_attempts.

## Personas
- **Karyawan**: cari barang → booking → dapat kode pintu + receipt → kembalikan.
- **Admin**: approve/reject via web dashboard atau Telegram inline button; monitor overdue, akses, log.

## Implemented (2026-06)- Auth JWT (cookie httpOnly) + role user/admin, seeding admin & demo user, brute-force lockout.
- Inventory CRUD + status AVAILABLE/BOOKED/BORROWED/MAINTENANCE, foto unik per barang.
- Booking: konflik/double-booking dicegah, maintenance memblok booking, cek booking bentrok milik user.
- Approve otomatis: Calendar event → access code (buffer configurable) → receipt → notifikasi user & admin.
- Access code hanya muncul setelah approved; Copy Code + panduan buka pintu; expiry & revoke otomatis.
- Receipt/borrowing checklist + download PDF (jsPDF).
- Return flow (kondisi baik/rusak ringan/berat/hilang + catatan) → admin Terima/Rusak.
- Extend, cancel, regenerate/disable access, overdue detection + reminder (scheduler 60s).
- Notification engine multi-channel (in-app/Telegram/WhatsApp) dengan status, error log, retry otomatis.
- Access log, audit log, notification log, admin settings buffer.
- Telegram bot: webhook secret verification, admin whitelist, inline button approve/reject/return/extend/access, command /home /pending /overdue /akses /barang.

## Model Order (v2 — GoFood style, 2026-06)
Satu order berisi banyak alat + jumlah (pcs). Form: Nama, Tanggal Pengambilan, Jam,
Durasi Peminjaman (4/8/24/48/72/168 jam), Acara, Lokasi. Katalog dikelompokkan per kategori
(Camera, Battery, Memory, Lens, Multicam Set, Audio/Mic, Cable Audio, Others), stok per item,
ketersediaan dihitung per qty × rentang waktu (bukan blok seluruh item).
- **Invoice peminjaman**: list alat grouped per kategori + export PDF.
- **Checklist pengembalian**: checkbox per alat, hanya bisa dicentang pada hari pengembalian (WIB);
  pengajuan return ditolak sampai semua alat dicentang.
- **WhatsApp dihapus total** (Meta tidak mendukung grup). Notifikasi admin lewat grup Telegram.

## Status integrasi
- **Telegram: LIVE** — @DataEquipmentTrackerbot, grup admin "Alat" (`-1003912804350`), webhook + secret.
- WhatsApp: **DIHAPUS** dari sistem (Meta Cloud API tidak mendukung grup WhatsApp).
- Google Calendar: **LIVE** — calendar `yncrewcalendar@gmail.com` ("Jadwal Pemakaian tempat dan alat") via service account `dexter@dexter-506401.iam.gserviceaccount.com`. JSON key disimpan base64 di `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON mentah rusak karena dotenv meng-escape newline private key). Create/update/delete event terverifikasi.
- BARDI/Tuya: mode SIMULASI sampai `TUYA_ACCESS_ID/SECRET/DEVICE_ID` diisi.

## Laporan (2026-06)
Tab "Laporan" di admin + command Telegram `/laporan`: barang paling sering dipinjam,
peminjam teraktif, user sering terlambat, grafik tren (7/30/90 hari), export CSV & PDF.

## Backlog
- P1: isi kredensial nyata + set Telegram webhook; kirim receipt via email/WhatsApp.
- P2: multi-gudang & multi-pintu, QR code check-in, laporan/analytics, foto upload untuk kerusakan (object storage).
- P3: Telegram Mini App, advanced permissions.
