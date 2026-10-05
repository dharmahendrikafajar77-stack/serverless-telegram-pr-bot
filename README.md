# 📓 Rangkuman Komprehensif Proyek: Monalissa PR Bot
**Sistem Manajemen Divisi Public Relations (Serverless Telegram Bot)**

Dokumen ini merangkum seluruh arsitektur, fitur, dan *progress* pengembangan bot Telegram "Monalissa" untuk mempermudah transisi pengerjaan Anda di perangkat baru.

## 🏗️ 1. Arsitektur Dasar & Infrastruktur
- **Platform:** Google Apps Script (GAS) dengan pendekatan *Serverless*.
- **Database:** Google Spreadsheet (melalui Sheet API bawaan GAS).
- **Penyimpanan File:** Google Drive (untuk menyimpan foto bukti kegiatan dan poster).
- **Komunikasi Telegram:** Menggunakan sistem Webhook (`doPost()`). 
  - *Perbaikan Kritis:* Kita telah memperbaiki isu HTTP 302 dengan memastikan GAS me-*return* status `200 OK` (menggunakan `return;`) agar Telegram tidak nyangkut (*stuck* antrean).
- **Konfigurasi (Script Properties):** Token Telegram, Sheet ID, Grup ID, Folder ID Drive, Gemini API Key, dan URL Webhook (baru saja ditambahkan) tidak lagi di-*hardcode*, melainkan diamankan di dalam `Script Properties`.

---

## ⚙️ 2. Daftar Modul Utama (Slash Commands)

### A. Sistem & Keamanan
- `/start` atau `hey`: Perkenalan bot.
- `/tutor`: Memunculkan panduan fitur.
- `/cekid`: Mengecek ID *Chat* / Grup (berguna saat instalasi awal).
- `/daftar [Nama Lengkap]`: Pendaftaran user agar bot bisa mengirim *Direct Message* (DM/Japri) untuk *reminder* H-1.
- `/broadcast`: Mengirim pesan masal ke seluruh user terdaftar.

### B. Modul Undangan & Delegasi (Selesai 100%)
- `/i [Pengirim, Kegiatan, Tanggal, Jam, Lokasi]`: Input undangan (dilengkapi Auto-ID `Uxx` & sistem Anti Duplikat).
- `/a [ID] [Nama]`: Mengambil tugas delegasi.
- `/tarik [ID] [Nama]`: Membatalkan keikutsertaan delegasi.
- `/info`, `/info semua`, `/info bulan [bulan]`: Memantau jadwal undangan yang ada.
- `/f [ID]`: *Upload* foto bukti kehadiran (menggunakan *Caption* gambar).
- `/edit` & `/hapus`: CRUD (*Create, Read, Update, Delete*) data undangan.
- *Fitur Cerdas:* Dilengkapi **Inline Keyboard** validasi nama panggilan. Jika dua orang punya panggilan yang sama, bot memberikan tombol pilihan.

### C. Modul Media Partner / Medpart (Hampir Selesai)
- `/mp`: Mendaftarkan klien (Auto-ID `Mxx`).
- `/info medpart`: Cek kelengkapan syarat (Link Gdrive) & poster.
- `/fmp [ID]`: *Upload* poster final ke Google Drive.
- `/edit` & `/hapus`: CRUD khusus Media Partner.

### D. Modul Sponsorship & Partnership (Prototipe Awal)
- `/sp` dan `/pt`: Saat ini baru sebatas pendaftaran data mentah tanpa ID unik atau fungsi *tracking*. **Ini adalah target perombakan selanjutnya.**

---

## 🤖 3. Kecerdasan Buatan (Integrasi Gemini AI)
- Menerjemahkan bahasa gaul / *natural language* menjadi perintah baku (*slash commands*).
- **Pemicu:** `/ai [teks]` atau `/monalissa [teks]`.
- **Posisi Pemrosesan:** Blok AI sudah dieksekusi di posisi **paling atas** pada `Code.gs` agar perintah yang diterjemahkan bisa langsung ditangkap oleh sistem.
- **Aturan Ketat (Prompt):**
  - Hanya akan membuat format `/i` jika kelima syarat terpenuhi (Pengirim, Kegiatan, Tanggal, Jam, Lokasi).
  - Bisa memproses input waktu yang fleksibel ("besok", "jam 7 pagi").
  - **Dilarang menanyakan Tahun** (Karena kepengurusan PR berganti secara *annual*/tahunan, dan Sheet akan di-reset setiap tahun).
  - Bisa mendeteksi niat pengecekan `/info medpart`, `/info bulan september`, `/a`, `/tarik`, `/hapus`, dsb.

---

## ⏱️ 4. Trigger Otomatis (Pekerja Latar Belakang)
Berjalan otomatis menggunakan *Time-Driven Triggers* dari Google:
1. `reminderBelumAdaDelegasi()`: Menagih grup untuk mencari delegasi pada acara H-2 / H-1.
2. `reminderDelegasi()`: Mengirim pengingat *Japri* (DM) ke anggota yang bertugas besok dan hari ini.
3. `rekapBulanan()`: Mengirim *Leaderboard* keaktifan setiap tanggal 1.
4. `hapusDelegasiTanpaBukti()`: Cek H+3 acara. Jika tidak ada bukti foto, bot melempar tombol ke Admin Grup untuk mengeksekusi Hapus atau Toleransi.
5. `reminderMedpart()`: Cek kelipatan 3 hari. Menagih tim PR via tombol jika Syarat atau Poster masih kosong (lengkap dengan tombol Batal Medpart).
6. `autoHealWebhook()`: *Watchdog* setiap 5-10 menit. Jika Telegram macet (*error 302* / banyak pending), fungsi ini otomatis memicu `resetWebhook()` agar bot sehat kembali.

---

## 🧪 5. Prototipe Masa Depan: Menu Interaktif (Wizard)
- Berada di dalam sub-folder `Interactive/WizardMenu.js`.
- Menggunakan konsep **ReplyKeyboardMarkup** (Tombol kustom menggantikan Keyboard Ponsel).
- Menggunakan sistem **State Machine** berbantuan `CacheService` untuk mengingat percakapan.
- Memungkinkan pengguna untuk menginput formulir secara bertahap (tanya jawab) tanpa harus hafal *slash commands*.
- **Rencana ke Depan:** Menyatukan konsep *Interactive Wizard* ini ke dalam *Code.gs* utama untuk merombak fitur **Sponsorship & Partnership (SP/PT)**.
- **Catatan Teknis (Tombol Clover 🍀):** Tombol menu interaktif ini tidak perlu dipanggil setiap saat dengan `/menu`. Nantinya, `ReplyKeyboardMarkup` ini akan ditempelkan satu kali pada balasan perintah `/start`. Setelah pengguna menekan `/start`, Telegram akan menyimpan logo *Clover* tersebut secara permanen di pojok kanan input *chat*, sehingga pengguna cukup mengklik logo tersebut kapan saja untuk memunculkan panel Menu.

---
*Dokumen ini merupakan checkpoint pengembangan terkini. Selamat berpindah ke *device* yang baru, Jendral!* 🫡
