# Modul Keahlian Telegram Bot (Google Apps Script)

Dokumen ini berisi panduan, pola (*design patterns*), dan kumpulan keahlian (*skills*) berharga yang telah kita terapkan di Bot PR (Monalissa). Pola-pola ini sangat fleksibel dan dapat digunakan kembali (reusable) sebagai fondasi utama untuk membangun **Bot HRD** atau bot Telegram divisi lainnya di masa depan.

---

## 1. Arsitektur Dasar: Webhook & Penerimaan Pesan
Pola ini digunakan untuk menerima pembaruan dari Telegram melalui Webhook.
Telegram mengirimkan data berformat JSON setiap kali ada interaksi (pesan teks, foto, klik tombol).

```javascript
function doPost(e) {
  // 1. Mencegah error jika web app diakses secara manual
  if (!e || !e.postData || !e.postData.contents) {
    return HtmlService.createHtmlOutput("OK");
  }
  
  // 2. Parsing JSON dari Telegram
  var update = JSON.parse(e.postData.contents);
  
  // 3. Routing: Pisahkan antara klik tombol (callback) dan chat biasa (message)
  if (update.callback_query) {
    handleCallback(update.callback_query);
    return HtmlService.createHtmlOutput("OK");
  }
  
  var msg = update.message;
  if (msg) {
    processUpdate(msg); // Lemparkan ke fungsi pemroses teks/foto
  }
  
  return HtmlService.createHtmlOutput("OK");
}
```

---

## 2. Pola UI Interaktif (Inline Keyboards & Callback Handlers)
Alih-alih menyuruh user mengetik perintah yang panjang, berikan tombol di bawah pesan. Ini sangat berguna untuk menu navigasi.

**A. Mengirim Pesan dengan Tombol**
```javascript
var textBaru = "Pilih departemen yang ingin dituju:";
var keyboard = {
  inline_keyboard: [
    [
      { "text": "👥 Recruitment", "callback_data": "MENU|RECRUITMENT" },
      { "text": "💼 Payroll", "callback_data": "MENU|PAYROLL" }
    ],
    [
      { "text": "🔙 Kembali", "callback_data": "MENU_UTAMA" }
    ]
  ]
};

UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
  method: "post",
  contentType: "application/json",
  payload: JSON.stringify({
    chat_id: String(chatId),
    text: textBaru,
    parse_mode: "Markdown",
    reply_markup: keyboard
  })
});
```

**B. Menangkap Klik Tombol (handleCallback)**
Saat user mengklik tombol, bot BUKAN mengirim pesan baru, melainkan **mengedit pesan yang lama** (`editMessageText`) agar chat tidak menjadi *spam*.
```javascript
function handleCallback(callbackQuery) {
  var action = callbackQuery.data;
  var chatId = callbackQuery.message.chat.id;
  var messageId = callbackQuery.message.message_id;
  var parts = action.split("|"); // Contoh: ["MENU", "RECRUITMENT"]
  
  if (parts[0] === "MENU") {
     var divisi = parts[1];
     var textBaru = "Anda memilih divisi: " + divisi;
     
     // EDIT pesan yang tombolnya baru saja diklik
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { 
         method: "post", 
         contentType: "application/json", 
         payload: JSON.stringify({ 
             chat_id: String(chatId), 
             message_id: messageId, 
             text: textBaru, 
             parse_mode: "Markdown" 
         }) 
     });
  }
  
  // WAJIB: Balas callback agar tombol berhenti "loading"
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
}
```

---

## 3. Sistem "State Management" (Wizard Flow)
Ini adalah penemuan terpenting kita! Daripada meminta user mengetik `/input Budi, Cuti, 12 Nov`, kita memandu mereka secara bertahap seperti sedang di-wawancara. Kita menggunakan `CacheService` milik Google untuk mengingat *State* (Posisi) si pengguna.

**A. Mengaktifkan Mode Wizard**
*(Dipanggil di dalam handleCallback saat tombol ditekan)*
```javascript
var cache = CacheService.getScriptCache();
// Ingat bahwa user sedang dalam proses mengisi form cuti
cache.put("WIZ_STATE_" + userId, "WIZ_FORM_CUTI", 600); // Kadaluarsa dalam 10 menit (600 detik)
sendMessage(chatId, "Berapa hari Anda ingin mengambil cuti? (Ketik angkanya)");
```

**B. Menangkap Input Wizard**
*(Dipanggil di dalam processUpdate/text handler)*
```javascript
var userState = cache.get("WIZ_STATE_" + userId);

if (userState === "WIZ_FORM_CUTI") {
   // User baru saja membalas pertanyaan form cuti
   var jumlahCuti = msg.text;
   
   // Simpan ke database / spreadsheet
   simpanDataCuti(userId, jumlahCuti);
   
   // BERSIHKAN STATE agar bot kembali normal
   cache.remove("WIZ_STATE_" + userId);
   
   sendMessage(chatId, "✅ Form cuti berhasil disimpan!");
   return; // Stop eksekusi agar tidak dianggap salah perintah
}
```

---

## 4. Keamanan: Autentikasi Member & Admin
Sebuah bot organisasi seringkali dilarang digunakan oleh orang luar. Ini pola untuk mengecek otoritas.

**A. Mengecek Member di Grup Utama**
Mengecek apakah user yang menge-DM bot benar-benar ada di dalam grup Telegram resmi organisasi.
```javascript
function cekMemberGrup(userId) {
  var url = "https://api.telegram.org/bot" + token + "/getChatMember?chat_id=" + grupChatId + "&user_id=" + userId;
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(response.getContentText());
    if (data.ok) {
      var status = data.result.status; // "creator", "administrator", "member", atau "left"
      return {
        isMember: (status === "member" || status === "administrator" || status === "creator"),
        isAdmin: (status === "administrator" || status === "creator")
      };
    }
  } catch (e) {
    // Tangani error API
  }
  return { isMember: false, isAdmin: false };
}
```

**B. Whitelist Menggunakan Spreadsheet**
Hanya melayani user yang ID Telegram-nya terdaftar di Sheet khusus (`User_Bot`).
```javascript
function verifikasiMember(userId) {
  var sheetUser = SpreadsheetApp.openById(sheetId).getSheetByName("User_Bot");
  var data = sheetUser.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) {
      return { verified: true, nama: data[i][1] };
    }
  }
  return { verified: false };
}
```

---

## 5. Navigasi Cepat: Persistent Keyboard (Clover Menu)
Bot HRD dapat memiliki "Tombol Fisik" di bawah kolom input Telegram, sehingga user tidak perlu menghafal menu sama sekali.

**Mengirim Keyboard Permanen:**
```javascript
var replyKeyboard = {
  keyboard: [
    [{ text: "📝 Cuti" }, { text: "🏥 Sakit" }],
    [{ text: "🛠️ HRD Admin" }]
  ],
  resize_keyboard: true,
  is_persistent: true // Menu ini akan selalu ada walau chat ditutup
};

UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
  method: "post",
  contentType: "application/json",
  payload: JSON.stringify({
    chat_id: String(chatId),
    text: "Pilih menu HRD di bawah ini:",
    reply_markup: replyKeyboard
  })
});
```

**Menangkap Input Persistent Keyboard:**
Input dari tombol ini ditangkap sebagai **teks biasa**.
```javascript
if (text === "📝 Cuti") {
  // Munculkan Inline Keyboard (Wizard) untuk prosedur cuti
  kirimMenuCuti(chatId); 
}
```

---

## 6. Operasi Database: Mengelola Baris Spreadsheet
Bot Telegram sering kali menggunakan Spreadsheet sebagai database. Berikut pola anti-rusak untuk manipulasi data.

**Mencari dan Mengedit Data Spesifik:**
```javascript
var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Cuti");
var dataAll = sheet.getDataRange().getValues();
var barisDitemukan = -1;

// Asumsi ID Data ada di Kolom B (index 1)
for (var i = 0; i < dataAll.length; i++) {
   if (dataAll[i][1] === idCari) { 
       barisDitemukan = i + 1; // Array mulai dari 0, Google Sheet mulai dari 1
       break; 
   }
}

if (barisDitemukan !== -1) {
   // Update Kolom E (Status Cuti)
   sheet.getRange(barisDitemukan, 5).setValue("DISETUJUI"); 
}
```

**Menghapus dan Merapikan Nomor Urut Otomatis:**
Jika data dihapus, nomor urut di Kolom A akan hancur. Ini solusinya.
```javascript
sheet.deleteRow(barisDitemukan); // Hapus data lama

var lastRow = sheet.getLastRow();
var numRows = lastRow - 1; // Asumsi baris 1 adalah header
if (numRows > 0) {
   var newNumbers = [];
   for (var r = 1; r <= numRows; r++) {
      newNumbers.push([r]);
   }
   // Tulis ulang seluruh angka di Kolom A dari atas ke bawah
   sheet.getRange(2, 1, numRows, 1).setValues(newNumbers);
}
```

---

## 7. Membersihkan Jejak UI (Cleaner Bot)
Agar obrolan tidak penuh dengan pesan-pesan "Masukkan ID..." atau "Pilih Opsi...", kita menyimpan ID pesan sementara dan menghapusnya setelah form selesai (atau dibatalkan).

```javascript
// Saat mengirim pertanyaan, simpan ID pesannya:
function trackMsg(userId, messageId) {
    var cache = CacheService.getScriptCache();
    var listStr = cache.get("TRK_" + userId);
    var list = listStr ? JSON.parse(listStr) : [];
    list.push(messageId);
    cache.put("TRK_" + userId, JSON.stringify(list), 21600);
}

// Saat form selesai, hapus semua pesan yang terlacak:
function clearWizardMessages(chatId, userId) {
    var cache = CacheService.getScriptCache();
    var listStr = cache.get("TRK_" + userId);
    if (listStr) {
       var list = JSON.parse(listStr);
       for (var i = 0; i < list.length; i++) {
          UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/deleteMessage?chat_id=" + chatId + "&message_id=" + list[i], {muteHttpExceptions:true});
       }
       cache.remove("TRK_" + userId);
    }
}
```

---

Kumpulan pola di atas sudah teruji secara fungsional di lingkungan produksi divisi PR. Pola-pola ini dapat dirakit ulang dan dikembangkan secara fleksibel untuk menangani kasus operasional SDM (seperti absen, reimbursements, peringatan, dll.) pada Bot HRD mendatang.
