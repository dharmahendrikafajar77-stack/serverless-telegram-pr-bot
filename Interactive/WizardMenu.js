/**
 * PROTOTIPE: INTERACTIVE WIZARD & CUSTOM KEYBOARD
 * Folder: Interactive/WizardMenu.js
 * 
 * Konsep:
 * 1. ReplyKeyboardMarkup: Tombol menu permanen yang menggantikan keyboard QWERTY (Logo Clover 🍀).
 * 2. State Machine (Wizard): Meminta input satu per satu kepada pengguna dan menyimpan progresnya 
 *    menggunakan CacheService karena Google Apps Script bersifat Serverless/Stateless.
 */

// 1. MEMUNCULKAN MENU CLOVER (REPLY KEYBOARD)
function kirimMenuUtama(chatId) {
  var keyboard = {
    "keyboard": [
      [{"text": "📝 Input Undangan Baru"}, {"text": "🤝 Input Medpart"}],
      [{"text": "📊 Cek Jadwal"}, {"text": "👥 Daftar Delegasi"}]
    ],
    "resize_keyboard": true, // Menyesuaikan ukuran tombol agar tidak terlalu besar
    "one_time_keyboard": false // Keyboard akan selalu ada (logo clover)
  };
  
  var payload = {
    "chat_id": chatId,
    "text": "Selamat datang di *Menu Interaktif Monalissa*! 💅\nSilakan pilih menu di bawah ini:",
    "parse_mode": "Markdown",
    "reply_markup": JSON.stringify(keyboard)
  };
  
  // UrlFetchApp.fetch(...) untuk mengirim pesan ke Telegram
}

// 2. LOGIKA STATE MACHINE (WIZARD PENGISIAN BERTAHAP)
function processInteractiveUpdate(update) {
  var msg = update.message;
  var chatId = msg.chat.id;
  var userId = msg.from.id;
  var text = msg.text;
  
  // Kita gunakan CacheService untuk menyimpan "Ingatan" bot tentang user ini selama 10 menit
  var cache = CacheService.getScriptCache();
  var userState = cache.get("STATE_" + userId);
  
  // JIKA USER MENEKAN TOMBOL "📝 Input Undangan Baru"
  if (text === "📝 Input Undangan Baru") {
    sendMessage(chatId, "Siyapp! Mari kita buat undangan baru. ✍️\n\nSiapa *Nama Pengirim* undangannya? (Contoh: BEM, UKKPK)");
    // Set status user menjadi sedang mengisi Pengirim
    cache.put("STATE_" + userId, "ISI_PENGIRIM", 600); 
    return;
  }
  
  // JIKA USER SEDANG DALAM PROSES WIZARD
  if (userState !== null) {
    
    // Tahap 1: Menerima nama pengirim, lanjut tanya kegiatan
    if (userState === "ISI_PENGIRIM") {
      cache.put("DATA_PENGIRIM_" + userId, text, 600); // Simpan jawaban
      sendMessage(chatId, "Oke, Pengirimnya *" + text + "*.\n\nSekarang, apa *Nama Kegiatan* acaranya?");
      cache.put("STATE_" + userId, "ISI_KEGIATAN", 600); // Lanjut ke tahap berikutnya
      return;
    }
    
    // Tahap 2: Menerima nama kegiatan, lanjut tanya waktu
    else if (userState === "ISI_KEGIATAN") {
      cache.put("DATA_KEGIATAN_" + userId, text, 600);
      sendMessage(chatId, "Sip! Kapan acara ini dilaksanakan? (Contoh: Selasa, 25 Oktober 2026 jam 09:00)");
      cache.put("STATE_" + userId, "ISI_WAKTU", 600);
      return;
    }
    
    // Tahap 3: Menerima waktu, lanjut tanya lokasi
    else if (userState === "ISI_WAKTU") {
      cache.put("DATA_WAKTU_" + userId, text, 600);
      sendMessage(chatId, "Catat! Terakhir nih, di mana *Lokasi* acaranya?");
      cache.put("STATE_" + userId, "ISI_LOKASI", 600);
      return;
    }
    
    // Tahap Akhir: Menerima lokasi, gabungkan semua data!
    else if (userState === "ISI_LOKASI") {
      var pengirim = cache.get("DATA_PENGIRIM_" + userId);
      var kegiatan = cache.get("DATA_KEGIATAN_" + userId);
      var waktu = cache.get("DATA_WAKTU_" + userId);
      var lokasi = text;
      
      // Bersihkan ingatan bot karena proses sudah selesai
      cache.remove("STATE_" + userId);
      cache.remove("DATA_PENGIRIM_" + userId);
      cache.remove("DATA_KEGIATAN_" + userId);
      cache.remove("DATA_WAKTU_" + userId);
      
      // JIKA KITA MAU, KITA BISA LEMPAR HASIL INI KE AI DULU UNTUK DIRAPIKAN FORMATNYA!
      // ...
      
      // Kirim hasil akhir ke grup!
      var ID_BARU = "U99"; // Contoh ID
      var hasilAkhir = "🚨 *UNDANGAN BARU MASUK!* 🚨\n\n" +
                       "ID Surat: " + ID_BARU + "\n" +
                       "UK Pengirim: " + pengirim + "\n" +
                       "Kegiatan: " + kegiatan + "\n" +
                       "Waktu: " + waktu + "\n" +
                       "Lokasi: " + lokasi + "\n\n" +
                       "👥 *Siapa yang bersedia? Balas pesan ini:* \n`/a " + ID_BARU + " Nama_Kamu`";
                       
      sendMessage(chatId, "Hore! Berhasil dibuat! 💅\nIni hasilnya:\n\n" + hasilAkhir);
      return;
    }
  }
}
