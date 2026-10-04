var scriptProperties = PropertiesService.getScriptProperties();
var token = scriptProperties.getProperty('TELEGRAM_TOKEN'); 
var sheetId = scriptProperties.getProperty('SHEET_ID'); 
var grupChatId = scriptProperties.getProperty('GRUP_CHAT_ID'); 
var folderId = scriptProperties.getProperty('FOLDER_ID'); 
var geminiApiKey = scriptProperties.getProperty('GEMINI_API_KEY'); 
function smartTitleCase(str) {
  var acronyms = ["MKU", "PKM", "LP2M", "GOR", "FIP", "FEB", "UNP", "BEM", "UKK", "UKFF", "UPKK", "UKKPK"];
  var result = str.toLowerCase().split(/\b/).map(function(word) {
    var upper = word.toUpperCase();
    if (acronyms.indexOf(upper) !== -1 || upper.match(/^[A-Z]+\d+[A-Z]*$/)) {
       return upper; 
    }
    if (word === "lantai" || word === "lt") return "Lt.";
    return (word.charAt(0).toUpperCase() + word.slice(1));
  }).join('');
  
  result = result.replace(/,\s*Lt\./g, " Lt.").replace(/\s+/g, " ");
  return result;
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) return ContentService.createTextOutput("OK");
  var update = JSON.parse(e.postData.contents);
  
  if (update.callback_query) {
    handleCallback(update.callback_query);
    return;
  }
  
  var msg = update.message;
  
  if (!msg) return;

  var chatId = msg.chat.id;
  var text = msg.text || msg.caption || ""; 
  var teksLower = text.toLowerCase().trim();
  
  // Normalisasi command jika dipanggil via menu pop-up di grup (contoh: /info@UKBAPR_Bot -> /info)
  if (text.startsWith("/")) {
     var parts = text.split(" ");
     var cmdPart = parts[0];
     if (cmdPart.indexOf("@") !== -1) {
        parts[0] = cmdPart.split("@")[0];
        text = parts.join(" ");
     }
  }
  
 // 1. KOTAK PANDUAN (/start & /tutor)
  if (teksLower === "/start" || teksLower === "hey") {
    sendMessage(chatId, "Halo Tim PR! Kenalin, aku *Monalissa* 💅, asisten digital 24 jam kebanggaan divisi PR UKBA.\n\nKetik `/tutor` kalau kamu butuh panduan, atau `/info` untuk lihat daftar undangan ter-update!");
    return; 
  }

  if (text === "/cekid") {
    sendMessage(chatId, "ID untuk chat ini adalah:\n`" + chatId + "`\n\nSilakan copy angka di atas dan masukkan persis seperti itu ke dalam nilai GRUP_CHAT_ID di Script Properties!");
    return;
  }

 if (teksLower === "/tutor") {
    var tutorText = "📚 *PANDUAN LENGKAP MONALISSA* 📚\n\n" +
      "🔹 `/i` *(Input Undangan Baru)*\nKetik langsung:\n`/i Pengirim, Kegiatan, Tgl/Bln, Jam Menit, Lokasi`\n\n" +
      "🔹 `/a` *(Ambil Delegasi)*\nKetik: `/a ID_Surat Nama_Kamu`\n\n" +
      "🔹 `/tarik` *(Batal Delegasi)*\nKetik: `/tarik ID_Surat Nama_Kamu`\n\n" +
      "🔹 `/info` *(Daftar Undangan)*\n" +
      "   • `/info` : Lihat undangan mendatang\n" +
      "   • `/info semua` : Lihat semua data\n" +
      "   • `/info bulan [nama_bulan]` : Rekap bulan tertentu\n\n" +
      "🔹 `/f` *(Upload Foto Bukti)*\nKirim foto acara, beri caption: `/f ID_Surat`\n\n" +
      "🔹 `/edit` *(Ubah Data)*\nKetik: `/edit ID_Surat Kolom NilaiBaru`\n_(Kolom: Pengirim/Kegiatan/Waktu/Lokasi)_\n\n" +
      "🔹 `/hapus` *(Hapus Undangan)*\nKetik: `/hapus ID_Surat`\n\n" +
      "🔹 `/mp` *(Media Partner)*\nKirim foto poster dengan caption formulir:\n`/mp\nInstansi: ...\nTanggal Upload: ...`\n\n" +
      "🔹 `/sp` *(Sponsorship)*\nKetik formulir:\n`/sp\nInstansi: ...\nTanggal: ...\nPersyaratan: ...\nBenefit: ...`\n\n" +
      "🔹 `/pt` *(Partnership)*\nKetik formulir:\n`/pt\nInstansi: ...\nPersyaratan: ...\nBenefit: ...\nMulai: ...\nSelesai: ...`\n\n" +
      "🔹 `/daftar Nama Lengkap`\n_(Wajib! Agar bot bisa kirim pengingat ke DM-mu)_";
    sendMessage(chatId, tutorText);
    return;
  }

  if (text.startsWith("/info")) {
    var inputInfo = text.toLowerCase().trim();
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
    var data = sheet.getDataRange().getValues();

    var namaHariArr = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    var namaBulanArr = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

    var hariIni = new Date();
    hariIni.setHours(0,0,0,0);
    var tahunIni = hariIni.getFullYear();

    // Mode default kita ubah namanya menjadi "mendatang" agar lebih pas secara logika
    var mode = "mendatang"; 
    var targetBulan = -1;

    if (inputInfo === "/info medpart") {
      var sheetMp = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart") || SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
      if (!sheetMp) return sendMessage(chatId, "❌ Sheet Medpart tidak ditemukan!");
      
      var dataMp = sheetMp.getDataRange().getValues();
      var listMp = "";
      var countMp = 0;
      
      for (var i = 2; i < dataMp.length; i++) {
         var idMp = dataMp[i][1];
         var instansi = dataMp[i][3];
         var tglUpload = dataMp[i][5];
         var bukti = dataMp[i][6] ? String(dataMp[i][6]).trim() : "";
         var poster = dataMp[i][7] ? String(dataMp[i][7]).trim() : "";
         
         if (idMp && instansi) {
            var statusSyarat = (bukti !== "" && bukti.toLowerCase() !== "menunggu syarat" && bukti.toLowerCase() !== "belum ada") ? "✅ Tersedia" : "❌ Menunggu Syarat";
            var statusPoster = (poster !== "") ? "✅ Tersedia" : "❌ Belum Ada";
            
            listMp += "🔹 *" + idMp + "* (" + instansi + ")\n🗓️ Tgl Upload: " + tglUpload + "\n📌 Syarat: " + statusSyarat + "\n📌 Poster: " + statusPoster + "\n\n";
            countMp++;
         }
      }
      
      if (countMp === 0) {
         return sendMessage(chatId, "✨ *Belum Ada Media Partner* ✨\n\nWah, belum ada data Media Partner sama sekali di database kita!");
      }
      
      var finalMp = "🤝 *STATUS MEDIA PARTNER TERKINI* 🤝\n\n" + listMp;
      if (finalMp.length > 4000) {
         var pesanArray = finalMp.split("\n\n");
         var pesanKirim = "";
         for (var p = 0; p < pesanArray.length; p++) {
            if ((pesanKirim.length + pesanArray[p].length) > 4000) {
               sendMessage(chatId, pesanKirim.trim());
               pesanKirim = ""; 
            }
            pesanKirim += pesanArray[p] + "\n\n";
         }
         if (pesanKirim.trim() !== "") sendMessage(chatId, pesanKirim.trim());
      } else {
         sendMessage(chatId, finalMp.trim());
      }
      return;
    }

    if (inputInfo === "/info semua") {
      mode = "semua";
    } else if (inputInfo.startsWith("/info bulan")) {
      mode = "bulan";
      var parts = inputInfo.split(" ");
      if (parts.length > 2) {
         var bulanInput = parts[2];
         for (var b = 0; b < namaBulanArr.length; b++) {
            if (namaBulanArr[b].toLowerCase() === bulanInput) {
               targetBulan = b; break;
            }
         }
         if(targetBulan === -1) return sendMessage(chatId, "❌ Nama bulan tidak dikenali. Gunakan contoh: `/info bulan maret`");
      } else {
         targetBulan = hariIni.getMonth(); 
      }
    }

    var listUndangan = "";
    var count = 0;

    for (var i = 2; i < data.length; i++) {
      var idSurat = data[i][1];
      var uk = data[i][3];
      var kegiatan = data[i][4];
      var waktu = data[i][5];
      var lokasi = data[i][6];
      var delegasi = data[i][7] ? String(data[i][7]).trim() : "";

      if (idSurat && waktu) {
        var tglAcara;
        var jam = "00";
        var menit = "00";

        if (waktu instanceof Date) {
           tglAcara = new Date(waktu);
           jam = String(tglAcara.getHours()).padStart(2, '0');
           menit = String(tglAcara.getMinutes()).padStart(2, '0');
        } else {
           var waktuTeks = String(waktu).trim();
           var parts = waktuTeks.split(" ");
           var dateParts = parts[0].split(/[-/]/);

           if (dateParts.length >= 2) {
              var tParts = parts[1] ? parts[1].replace(/[^0-9:]/g, "").split(":") : ["00", "00"];
              jam = String(tParts[0] || "00").padStart(2, '0');
              menit = String(tParts[1] || "00").padStart(2, '0');
              tglAcara = new Date(tahunIni, parseInt(dateParts[1]) - 1, parseInt(dateParts[0]), parseInt(jam), parseInt(menit));
           }
        }

        if (tglAcara && !isNaN(tglAcara.getTime())) {
           var tglFormat = String(tglAcara.getDate()).padStart(2, '0');
           var namaHari = namaHariArr[tglAcara.getDay()];
           var namaBulanStr = namaBulanArr[tglAcara.getMonth()];
           var waktuTampil = namaHari + " (" + jam + ":" + menit + " WIB) " + tglFormat + " " + namaBulanStr;

           var rincian = "🔹 *" + idSurat + "* (" + uk + " - " + kegiatan + ")\n📍 " + waktuTampil + " - " + lokasi + "\n";
           var masukKriteria = false;

           if (mode === "semua") {
              masukKriteria = true;
           } else if (mode === "bulan") {
              if (tglAcara.getMonth() === targetBulan) masukKriteria = true;
           } else if (mode === "mendatang") {
              tglAcara.setHours(0,0,0,0);
              var belumLewat = tglAcara.getTime() >= hariIni.getTime();
              
              // PERUBAHAN: Syarat (delegasi === "") dihapus.
              // Selama acaranya belum lewat (atau hari ini), masukkan ke daftar!
              if (belumLewat) masukKriteria = true; 
           }

           if (masukKriteria) {
              if (delegasi === "") listUndangan += rincian + "⬜ Delegasi: _(Belum ada delegasi)_\n\n";
              else listUndangan += rincian + "✅ Delegasi: *" + delegasi + "*\n\n";
              count++;
           }
        }
      }
    }

    // Balasan khusus jika data kosong
    if (count === 0) {
       if (mode === "mendatang") {
          // Narasi ini sekarang hanya keluar jika BENAR-BENAR tidak ada jadwal acara di masa depan
          return sendMessage(chatId, "✨ *Wah, jadwal kita lagi kosong nih!* ✨\n\nTidak ada undangan untuk dihadiri dalam waktu dekat. Waktunya tim PR istirahat cantik~ 💅");
       } else if (mode === "bulan") {
          return sendMessage(chatId, "📅 *REKAP UNDANGAN BULAN " + namaBulanArr[targetBulan].toUpperCase() + "* 📅\n\n_(Tidak ada data undangan untuk bulan ini)_");
       } else {
          return sendMessage(chatId, "📋 *SEMUA DATA UNDANGAN PR UKBA* 📋\n\n_(Belum ada data undangan di database)_");
       }
    }

    var headerInfo = "";
    // Judul Header disesuaikan karena isinya sudah campuran (kosong & terisi)
    if (mode === "mendatang") headerInfo = "📋 *UNDANGAN MENDATANG* 📋\n\n"; 
    else if (mode === "semua") headerInfo = "📋 *SEMUA DATA UNDANGAN PR UKBA* 📋\n\n";
    else headerInfo = "📅 *REKAP UNDANGAN BULAN " + namaBulanArr[targetBulan].toUpperCase() + "* 📅\n\n";

    var finalInfo = headerInfo + listUndangan;

    // Logika Pemecah Pesan Telegram (Batas 4000 Karakter)
    if (finalInfo.length > 4000) {
      var pesanArray = finalInfo.split("\n\n");
      var pesanKirim = "";
      
      for (var p = 0; p < pesanArray.length; p++) {
        if ((pesanKirim.length + pesanArray[p].length) > 4000) {
          sendMessage(chatId, pesanKirim.trim());
          pesanKirim = ""; 
        }
        pesanKirim += pesanArray[p] + "\n\n";
      }
      if (pesanKirim.trim() !== "") sendMessage(chatId, pesanKirim.trim());
      
    } else {
      sendMessage(chatId, finalInfo.trim());
    }
    
    return;
  }
  
  // 2. PENDAFTARAN USER UNTUK DM PERSONAL (Sudah Terintegrasi Database Anggota)
  if (text.startsWith("/daftar ")) {
    var namaInputRaw = text.replace("/daftar ", "").trim();
    var userId = msg.from.id; 
    
    // Validasi nama ke tab Data Pengurus
    var validasiNama = cariNamaLengkapDatabase(namaInputRaw);
    if (validasiNama.status === "multiple") {
       var keyboard = [];
       for (var i = 0; i < validasiNama.matches.length; i++) {
          keyboard.push([{ text: validasiNama.matches[i], callback_data: "DF|" + userId + "|" + validasiNama.matches[i] }]);
       }
       var url = "https://api.telegram.org/bot" + token + "/sendMessage";
       var payload = { chat_id: String(chatId), text: "Ditemukan beberapa nama yang mirip. Pilih nama lengkapmu yang benar: 💅", reply_markup: { inline_keyboard: keyboard } };
       UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(payload) });
       return;
    } else if (!validasiNama.status) {
        return sendMessage(chatId, validasiNama.msg); 
    }
    
    prosesDaftarUser(chatId, userId, validasiNama.nama);
    return;
  }

  // 3. BROADCAST DARI ADMIN
  if (teksLower.startsWith("/broadcast")) {
    var isiBroadcast = text.replace(new RegExp("^/broadcast\\s*", "i"), "").trim();
    if (isiBroadcast === "") {
       return sendMessage(chatId, "❌ *Pesan Broadcast Kosong!*\n\nSilakan ketik pesan yang ingin di-broadcast setelah perintah.\nContoh: `/broadcast Rapat divisi PR besok jam 8 pagi ya!`");
    }
    var sheetUser = SpreadsheetApp.openById(sheetId).getSheetByName("User_Bot");
    var dataUser = sheetUser.getDataRange().getValues();
    var count = 0;
    
    for (var u = 1; u < dataUser.length; u++) { 
      if (dataUser[u][0]) {
        sendMessage(dataUser[u][0], "📢 *PENGUMUMAN DARI ADMIN PR:*\n\n" + isiBroadcast);
        count++;
      }
    }
    sendMessage(chatId, "✅ Pesan broadcast berhasil dikirim ke " + count + " anggota.");
    return;
  }

  // ==========================================
  // 🤖 FITUR BARU: AI PENGENALAN UNDANGAN & PERINTAH
  // ==========================================
  
  // Pemicu super ringan: Hanya jalan jika diawali /monalissa atau /ai
  if (teksLower.startsWith("/monalissa ") || teksLower.startsWith("/ai ")) {
     
     sendMessage(chatId, "✨ Perintah di terima, wait ya ✨");
     
     // Hapus kata awalan agar AI tidak bingung
     var textToProcess = text;
     if (teksLower.startsWith("/monalissa ")) textToProcess = text.substring(11).trim();
     else if (teksLower.startsWith("/ai ")) textToProcess = text.substring(4).trim();
     
     var hasilExtract = extractUndanganWithGemini(textToProcess);
     
     if (hasilExtract && hasilExtract.indexOf("ERROR:") !== -1) {
        return sendMessage(chatId, "⚠️ *Monalissa Bingung:*\n" + hasilExtract.replace("ERROR:", "").trim());
     } else if (hasilExtract && hasilExtract.indexOf("/") !== -1) {
        // Ambil string tepat dari tulisan "/" sampai habis (mengabaikan backtick)
        var idx = hasilExtract.indexOf("/");
        text = hasilExtract.substring(idx).trim(); 
        sendMessage(chatId, "⚙️ Mengeksekusi Perintah ✨\n`" + text + "`");
     } else {
        return sendMessage(chatId, "❌ Maaf, AI Monalissa gagal merangkai format perintahnya.\n\n*Bocoran Jawaban AI:* " + (hasilExtract || "Kosong/Gagal Connect"));
     }
  }

// 4. INPUT UNDANGAN BARU (/i) - VERSI ANTI DUPLIKAT
  if (text.startsWith("/i")) {
    var textClean = text.replace("/i", "").trim();
    var dataRaw = textClean.split(/\n|,/);
    var data = [];
    for (var i = 0; i < dataRaw.length; i++) {
       var item = dataRaw[i].trim();
       if (item !== "") data.push(item);
    }
    
    if(data.length < 5) {
      sendMessage(chatId, "❌ Format kurang lengkap!\nGunakan: `/i Pengirim, Kegiatan, Tgl/Bln, Jam, Lokasi`");
      return;
    }

    data[0] = data[0].toUpperCase();           // Pengirim: UPPERCASE
    data[1] = smartTitleCase(data[1]);         // Kegiatan: Smart Title Case
    data[4] = smartTitleCase(data[4]);         // Lokasi: Smart Title Case
    
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan"); 
    
    // --- LOGIKA BARU: MENCARI ID TERBESAR ---
    var dataID = sheet.getRange("B3:B" + sheet.getLastRow()).getValues();
    var maxID = 0;
    for (var i = 0; i < dataID.length; i++) {
      var idSekarang = dataID[i][0].toString().replace("U", "");
      var angkaID = parseInt(idSekarang);
      if (!isNaN(angkaID) && angkaID > maxID) {
        maxID = angkaID;
      }
    }
    var nomorUrut = maxID + 1;
    var idSurat = "U" + String(nomorUrut).padStart(2, '0'); 
    // ---------------------------------------
    
    var now = new Date();
    var waktuDiterima = Utilities.formatDate(now, "Asia/Jakarta", "dd/MM HH:mm") + " WIB";
    
    var tglBlnRaw = data[2].split(/[-/]/);
    var tgl = tglBlnRaw[0] ? String(tglBlnRaw[0]).trim().padStart(2, '0') : "01";
    var bln = tglBlnRaw[1] ? String(tglBlnRaw[1]).trim().padStart(2, '0') : "01";
    
    var jamMenitRaw = data[3].replace(/[^0-9]/g, " ").trim().split(/\s+/);
    var jam = jamMenitRaw[0] ? String(jamMenitRaw[0]).padStart(2, '0') : "00";
    var menit = jamMenitRaw[1] ? String(jamMenitRaw[1]).padStart(2, '0') : "00";
    
    var waktuSheet = tgl + "/" + bln + " " + jam + ":" + menit + " WIB";

    var thn = now.getFullYear();
    var tglObj = new Date(thn, parseInt(bln) - 1, parseInt(tgl));
    var namaHari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][tglObj.getDay()];
    var namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][tglObj.getMonth()];
    
    var waktuTampil = namaHari + " (" + jam + ":" + menit + " WIB) " + tgl + " " + namaBulan;

    // Kolom A adalah nomor urut baris (bukan nomor ID U-xx)
    // Karena header ada 2 baris, maka nomor urut = baris tujuan - 2
    var barisTujuan = sheet.getLastRow() + 1;
    var nomorUrutKolomA = barisTujuan - 2;

    sheet.appendRow([nomorUrutKolomA, idSurat, waktuDiterima, data[0], data[1], waktuSheet, data[4], "", ""]);
    
    var balasan = "🚨 *UNDANGAN BARU MASUK!* 🚨\n\n*ID Surat:* " + idSurat + "\n*UK Pengirim:* " + data[0] + "\n*Kegiatan:* " + data[1] + "\n*Waktu:* " + waktuTampil + "\n*Lokasi:* " + data[4] + "\n\n👥 _Siapa yang bersedia? Balas pesan ini:_ \n`/a " + idSurat + " Nama_Kamu`";
    sendMessage(chatId, balasan);
    return;
  }

  // 5. MENGAMBIL DELEGASI (/a) 
  if (text.startsWith("/a")) {
     var textAmbil = text.replace("/a", "").trim();
     
     // Jika teks setelah /a kosong, kirim instruksi
     if (textAmbil === "") {
        return sendMessage(chatId, "❌ *ID Surat atau Nama belum diisi!*\n\nSilakan ketik perintah diikuti ID dan namamu.\nContoh: `/a U01 Dharma` 💅");
     }
     
     var parts = textAmbil.split(" ");
     if (parts.length < 2) return sendMessage(chatId, "❌ *Format salah!*\n\nGunakan: `/a ID_Surat Nama_Kamu` (Contoh: `/a U01 Dharma`) 💅");
     
     var idSuratDicari = parts[0].trim().toUpperCase();
     var namaInputRaw = parts.slice(1).join(" ");
     
     var validasiNama = cariNamaLengkapDatabase(namaInputRaw);
     if (validasiNama.status === "multiple") {
       var keyboard = [];
       for (var i = 0; i < validasiNama.matches.length; i++) {
          keyboard.push([{ text: validasiNama.matches[i], callback_data: "DL|" + idSuratDicari + "|" + validasiNama.matches[i] }]);
       }
       var url = "https://api.telegram.org/bot" + token + "/sendMessage";
       var payload = { chat_id: String(chatId), text: "Ditemukan beberapa nama yang mirip. Pilih nama delegasi yang benar: 💅", reply_markup: { inline_keyboard: keyboard } };
       UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(payload) });
       return;
     } else if (!validasiNama.status) {
         return sendMessage(chatId, validasiNama.msg); 
     }
     
     prosesDelegasiSheet(chatId, idSuratDicari, validasiNama.nama);
     return;
  }

  // FITUR HAPUS DATA UNDANGAN ATAU MEDPART (/hapus)
  if (text.startsWith("/hapus ")) {
     var idHapus = text.replace("/hapus ", "").trim().toUpperCase();
     if (idHapus === "") {
        return sendMessage(chatId, "❌ *ID belum diisi!*\nContoh: `/hapus U01` atau `/hapus M01`");
     }
     
     var isMedpart = idHapus.startsWith("M");
     var namaSheet = isMedpart ? "Medpart" : "Undangan";
     var headerRows = isMedpart ? 1 : 2;
     
     var sheet = SpreadsheetApp.openById(sheetId).getSheetByName(namaSheet);
     if (!sheet && isMedpart) sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
     
     if (!sheet) return sendMessage(chatId, "❌ Sheet " + namaSheet + " tidak ditemukan.");
     
     var dataAll = sheet.getDataRange().getValues();
     var barisDitemukan = -1;
     
     for (var i = 0; i < dataAll.length; i++) {
        if (dataAll[i][1] === idHapus) { barisDitemukan = i + 1; break; }
     }
     
     if (barisDitemukan !== -1) {
        sheet.deleteRow(barisDitemukan);
        
        // Update Penomoran Otomatis (Kolom NO)
        var lastRow = sheet.getLastRow();
        var numRows = lastRow - headerRows; 
        if (numRows > 0) {
           var newNumbers = [];
           for (var r = 1; r <= numRows; r++) {
              newNumbers.push([r]);
           }
           sheet.getRange(headerRows + 1, 1, numRows, 1).setValues(newNumbers);
        }
        
        var jenis = isMedpart ? "Media Partner" : "Undangan";
        sendMessage(chatId, "✅ Data " + jenis + " *" + idHapus + "* berhasil dihapus secara permanen dan penomoran (NO) telah dirapikan kembali. 💅");
     } else {
        sendMessage(chatId, "❌ ID *" + idHapus + "* tidak ditemukan di database " + (isMedpart ? "Medpart" : "Undangan") + ".");
     }
     return;
  }

  // FITUR EDIT UNDANGAN & MEDPART (/edit)
  if (text.startsWith("/edit ")) {
     var args = text.replace("/edit ", "").trim().split(" ");
     if (args.length < 3) {
        return sendMessage(chatId, "❌ *Format salah!*\nGunakan: `/edit ID Kolom NilaiBaru`\nContoh: `/edit U23 Lokasi Gedung C` atau `/edit M01 Bukti link_gdrive`");
     }
     
     var idEdit = args[0].toUpperCase();
     var kolomEdit = args[1].toLowerCase();
     var nilaiBaru = args.slice(2).join(" ");
     var isMedpart = idEdit.startsWith("M");
     
     var sheet = isMedpart ? SpreadsheetApp.openById(sheetId).getSheetByName("Medpart") || SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner") : SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
     
     if (!sheet) return sendMessage(chatId, "❌ Sheet " + (isMedpart ? "Medpart" : "Undangan") + " tidak ditemukan.");
     
     var dataAll = sheet.getDataRange().getValues();
     var barisDitemukan = -1;
     
     for (var i = 0; i < dataAll.length; i++) {
        if (dataAll[i][1] === idEdit) { barisDitemukan = i + 1; break; }
     }
     
     if (barisDitemukan !== -1) {
        var colIndex = -1;
        
        if (!isMedpart) {
            if (kolomEdit === "pengirim") colIndex = 4;
            else if (kolomEdit === "kegiatan") colIndex = 5;
            else if (kolomEdit === "waktu") colIndex = 6;
            else if (kolomEdit === "lokasi") colIndex = 7;
            
            if (colIndex === -1) return sendMessage(chatId, "❌ Kolom *" + kolomEdit + "* tidak dikenali. Pilih: Pengirim, Kegiatan, Waktu, Lokasi");
        } else {
            if (kolomEdit === "instansi") colIndex = 4;
            else if (kolomEdit === "cp") colIndex = 5;
            else if (kolomEdit === "tanggal") colIndex = 6; // Tanggal Upload
            else if (kolomEdit === "bukti") colIndex = 7;
            
            if (colIndex === -1) return sendMessage(chatId, "❌ Kolom *" + kolomEdit + "* tidak dikenali. Pilih: Instansi, Cp, Tanggal, Bukti");
        }
        
        sheet.getRange(barisDitemukan, colIndex).setValue(nilaiBaru);
        var jenis = isMedpart ? "Media Partner" : "surat";
        sendMessage(chatId, "✅ Data " + jenis + " *" + idEdit + "* berhasil diubah!\n\n*Kolom:* " + kolomEdit + "\n*Nilai Baru:* " + nilaiBaru + " 💅");
     } else {
        sendMessage(chatId, "❌ ID *" + idEdit + "* tidak ditemukan.");
     }
     return;
  }

  // FITUR TARIK DELEGASI (/tarik)
  if (text.startsWith("/tarik ")) {
     var args = text.replace("/tarik ", "").trim().split(" ");
     if (args.length < 2) {
        return sendMessage(chatId, "❌ *Format salah!*\nGunakan: `/tarik ID_Surat NamaLengkap`\nContoh: `/tarik U23 Dharma Fajar`");
     }
     
     var idSuratTarik = args[0].toUpperCase();
     var namaTarik = args.slice(1).join(" ");
     
     var validasiNama = cariNamaLengkapDatabase(namaTarik);
     if (validasiNama.status === "multiple") {
         return sendMessage(chatId, "⚠️ Ditemukan beberapa nama yang mirip. Tolong ketikkan nama lengkap yang lebih spesifik untuk ditarik!");
     } else if (!validasiNama.status) {
         return sendMessage(chatId, validasiNama.msg);
     }
     var namaBaku = validasiNama.nama;
     
     var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
     var dataAll = sheet.getDataRange().getValues();
     var barisDitemukan = -1;
     
     for (var i = 0; i < dataAll.length; i++) {
        if (dataAll[i][1] === idSuratTarik) { barisDitemukan = i + 1; break; }
     }
     
     if (barisDitemukan !== -1) {
        var selDelegasi = sheet.getRange(barisDitemukan, 8);
        var delegasiSekarang = selDelegasi.getValue().toString().trim();
        
        if (delegasiSekarang === "") {
           return sendMessage(chatId, "⚠️ Belum ada delegasi yang terdaftar di surat *" + idSuratTarik + "*.");
        }
        
        if (delegasiSekarang.indexOf(namaBaku) === -1) {
           return sendMessage(chatId, "⚠️ Nama *" + namaBaku + "* tidak ditemukan dalam daftar delegasi surat *" + idSuratTarik + "*.");
        }
        
        // Menghapus nama dan merapikan string delegasi (memisahkan koma)
        var delegasiArr = delegasiSekarang.split(",").map(function(item) { return item.trim(); });
        var newDelegasiArr = [];
        for (var d = 0; d < delegasiArr.length; d++) {
            if (delegasiArr[d] !== namaBaku) {
                newDelegasiArr.push(delegasiArr[d]);
            }
        }
        var delegasiBaru = newDelegasiArr.join(", ");
        
        selDelegasi.setValue(delegasiBaru);
        sendMessage(chatId, "✅ Delegasi *" + namaBaku + "* berhasil ditarik dari undangan *" + idSuratTarik + "*. 💅\n\n*Sisa Delegasi:* " + (delegasiBaru === "" ? "_(Kosong)_" : delegasiBaru));
     } else {
        sendMessage(chatId, "❌ ID Surat *" + idSuratTarik + "* tidak ditemukan.");
     }
     return;
  }

  // 6. UPLOAD BUKTI FOTO KEHADIRAN UNDANGAN (/f)
  if (text.startsWith("/f ") || text === "/f") {
    if (!msg.photo) {
       return sendMessage(chatId, "❌ *Foto tidak terdeteksi!*\n\nKamu harus mengirimkan foto bukti kehadiran bersamaan dengan perintah ini di kolom caption.\nContoh caption: `/f U01`");
    }
    
    var idSuratFoto = text.replace("/f", "").trim().toUpperCase();
    if (idSuratFoto === "") return sendMessage(chatId, "❌ Format salah! Jangan lupa masukkan ID Surat.\nContoh caption: `/f U01`");

    var fileIdTelegram = msg.photo[msg.photo.length - 1].file_id;
    
    var fileDataUrl = "https://api.telegram.org/bot" + token + "/getFile?file_id=" + fileIdTelegram;
    var response = UrlFetchApp.fetch(fileDataUrl);
    var filePath = JSON.parse(response.getContentText()).result.file_path;
    var downloadUrl = "https://api.telegram.org/file/bot" + token + "/" + filePath;
    var blob = UrlFetchApp.fetch(downloadUrl).getBlob();
    
    var folder = DriveApp.getFolderById(folderId);
    var savedFile = folder.createFile(blob);
    savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    var fileIdDrive = savedFile.getId();
    var directImageUrl = "https://drive.google.com/uc?export=view&id=" + fileIdDrive;
    
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
    var dataAll = sheet.getDataRange().getValues();
    var barisDitemukan = -1;
    for (var i = 0; i < dataAll.length; i++) {
        if (dataAll[i][1] === idSuratFoto) { barisDitemukan = i + 1; break; }
    }
    
    if(barisDitemukan !== -1) {
      sheet.getRange(barisDitemukan, 9).setFormula('=IMAGE("' + directImageUrl + '")');
      sendMessage(chatId, "📸 *Bukti Kehadiran Berhasil Diupload!*\n\nTerima kasih atas laporannya. Fotonya sudah dipajang cantik oleh Monalissa di database PR! 💅");
    } else {
      sendMessage(chatId, "❌ Foto gagal diproses: ID Surat *" + idSuratFoto + "* tidak ditemukan di database.");
    }
    return;
  }

  // ==========================================
  // FITUR UPLOAD POSTER MEDIA PARTNER (/fmp)
  // ==========================================
  if (text.startsWith("/fmp")) {
    if (!msg.photo) {
       return sendMessage(chatId, "❌ *Foto Poster tidak terdeteksi!*\n\nKamu harus mengirimkan foto poster final beserta caption: `/fmp ID_Medpart` (Contoh: `/fmp M01`)");
    }
    
    var idMpFoto = text.replace("/fmp", "").trim().toUpperCase();
    if (idMpFoto === "") return sendMessage(chatId, "❌ Format salah! Jangan lupa masukkan ID Medpart.\nContoh caption: `/fmp M01`");

    var fileIdTelegram = msg.photo[msg.photo.length - 1].file_id;
    var fileDataUrl = "https://api.telegram.org/bot" + token + "/getFile?file_id=" + fileIdTelegram;
    var response = UrlFetchApp.fetch(fileDataUrl);
    var filePath = JSON.parse(response.getContentText()).result.file_path;
    var downloadUrl = "https://api.telegram.org/file/bot" + token + "/" + filePath;
    var blob = UrlFetchApp.fetch(downloadUrl).getBlob();
    
    var folder = DriveApp.getFolderById(folderId);
    var savedFile = folder.createFile(blob);
    savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var directImageUrl = "https://drive.google.com/uc?export=view&id=" + savedFile.getId();
    
    var sheetMp = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart") || SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
    var dataAll = sheetMp.getDataRange().getValues();
    var barisDitemukan = -1;
    for (var i = 0; i < dataAll.length; i++) {
        // Kolom kedua (index 1) adalah ID Medpart
        if (dataAll[i][1] === idMpFoto) { barisDitemukan = i + 1; break; }
    }
    
    if(barisDitemukan !== -1) {
      // Kolom ke-8 adalah Poster
      sheetMp.getRange(barisDitemukan, 8).setFormula('=IMAGE("' + directImageUrl + '")');
      sendMessage(chatId, "📸 *Poster Media Partner Berhasil Disimpan!*\n\nKerja bagus! Poster final untuk " + idMpFoto + " sudah diamankan oleh Monalissa.\n\n_Pastikan kamu segera meneruskan (forward) pesan berisi poster ini ke Divisi Design and Media ya!_ 💅");
    } else {
      sendMessage(chatId, "❌ Foto gagal diproses: ID Medpart *" + idMpFoto + "* tidak ditemukan di database.");
    }
    return;
  }

  // ==========================================
  // FITUR MEDIA PARTNER (/mp) - FORMAT TABEL BARU (8 KOLOM)
  // ==========================================
  if (text.startsWith("/mp")) {
    var instansi = (text.match(/Instansi:\s*([^\n]+)/i) || [])[1];
    var cp = (text.match(/Cp:\s*([^\n]+)/i) || text.match(/Contact Person:\s*([^\n]+)/i) || [])[1];
    var waktu = (text.match(/Tanggal Upload:\s*([^\n]+)/i) || 
                 text.match(/Tanggal:\s*([^\n]+)/i) || 
                 text.match(/Waktu:\s*([^\n]+)/i) || [])[1];
    var linkBukti = (text.match(/Link Bukti:\s*([^\n]+)/i) || 
                     text.match(/Bukti:\s*([^\n]+)/i) || [])[1];

    if (!instansi) {
      return sendMessage(chatId, "❌ *Format salah!*\n\nMinimal kamu harus mencantumkan Nama Instansi. Silakan gunakan template ini:\n\n`/mp\nInstansi: \nCp: \nTanggal Upload: \nLink Bukti: `");
    }
    
    // Jika data tidak ada, isi dengan default text
    var cpFinal = (cp && cp.trim() !== "") ? cp.trim() : "Menunggu Syarat";
    var waktuFinal = (waktu && waktu.trim() !== "" && waktu.trim().toLowerCase() !== "menunggu syarat") ? waktu.trim() : "Menunggu Syarat";
    var linkBuktiFinal = (linkBukti && linkBukti.trim() !== "") ? linkBukti.trim() : "Belum Ada";

    // Gunakan fungsi smartTitleCase agar nama Instansi otomatis rapi!
    var instansiRapi = smartTitleCase(instansi);
    
    var sheetMp = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart"); 
    if (!sheetMp) {
       sheetMp = SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
    }
    
    if (!sheetMp) {
       return sendMessage(chatId, "❌ *Sistem Gagal!*\n\nMonalissa tidak bisa menemukan tab Sheet bernama 'Medpart' atau 'Media Partner'. Tolong pastikan nama tab di Google Sheets sudah benar dan tidak ada spasi berlebih!");
    }
    
    var lastRowMp = sheetMp.getLastRow();
    
    // Sistem ID Unik (Baca kolom A/NO atau otomatis +1)
    var newIdNumber = lastRowMp < 2 ? 1 : lastRowMp; 
    var newId = "M" + String(newIdNumber).padStart(2, '0');
    
    var tglFixed = waktuFinal;
    if (waktuFinal !== "Menunggu Syarat") {
        var tglRaw = waktuFinal.split(/[-/]/);
        if (tglRaw.length >= 2) {
            tglFixed = (tglRaw[0] ? tglRaw[0].trim().padStart(2, '0') : "01") + "/" + (tglRaw[1] ? tglRaw[1].trim().padStart(2, '0') : "01");
        }
    }

    // Urutan kolom: NO (1), ID Medpart (2), Tgl Masuk (3), Instansi (4), Cp (5), Tgl Upload (6), Bukti (7), Poster (8)
    sheetMp.appendRow([newIdNumber, newId, new Date(), instansiRapi, cpFinal, tglFixed, linkBuktiFinal, ""]); 
    
    return sendMessage(chatId, "✅ *DATA MEDIA PARTNER DICATAT!* 💅\n\n*ID Medpart:* " + newId + "\n*Instansi:* " + instansiRapi + "\n*Tanggal Upload:* " + tglFixed + "\n\n_Catatan:_\n1. Jika Link GDrive Bukti Syarat (Follow & Like) sudah dikirim oleh mereka, setor ke AI dengan bilang: *'Ini link bukti syarat buat " + newId + " https://drive...'*.\n2. Jika nanti Poster Final sudah direvisi, baru upload fotonya dengan caption `/fmp " + newId + "` ya!");
  }

  // ==========================================
  // FITUR SPONSORSHIP (/sp) - FORMAT FORMULIR & TEMPLATE
  // ==========================================
  if (text.startsWith("/sp")) {
    var instansi = (text.match(/Instansi:\s*([^\n]+)/i) || [])[1];
    var waktu = (text.match(/Tanggal:\s*([^\n]+)/i) || text.match(/Waktu:\s*([^\n]+)/i) || [])[1];
    var syarat = (text.match(/Persyaratan:\s*([\s\S]*?)(?=\nBenefit:|$)/i) || text.match(/Syarat:\s*([\s\S]*?)(?=\nBenefit:|$)/i) || [])[1];
    var benefit = (text.match(/Benefit:\s*([\s\S]*?)(?=$)/i) || [])[1];

    // Jika data tidak lengkap atau hanya mengetik /sp saja
    if (!instansi || !waktu || !syarat || !benefit) {
      return sendMessage(chatId, "💰 *TEMPLATE SPONSORSHIP* 💰\n\nSalin, isi, dan kirim format ini:\n\n`/sp`\n`Instansi: `\n`Tanggal: `\n`Persyaratan: `\n`Benefit: `");
    }
    
    var sheetSp = SpreadsheetApp.openById(sheetId).getSheetByName("Sponsorship");
    var lastRowSp = sheetSp.getLastRow();
    var nomorUrut = lastRowSp < 2 ? 1 : lastRowSp - 1;
    
    var tglRaw = waktu.trim().split(/[-/]/);
    var tglFixed = (tglRaw[0] ? tglRaw[0].trim().padStart(2, '0') : "01") + "/" + (tglRaw[1] ? tglRaw[1].trim().padStart(2, '0') : "01");

    // Urutan: NO, Instansi, Tanggal, Persyaratan, Benefit
    sheetSp.appendRow([nomorUrut, instansi.trim(), tglFixed, syarat.trim(), benefit.trim()]);
    return sendMessage(chatId, "💰 *DATA SPONSORSHIP DICATAT!* 💰\n\nInstansi: " + instansi.trim() + "\nBenefit:\n" + benefit.trim());
  }

  // ==========================================
  // FITUR PARTNERSHIP (/pt) - FORMAT FORMULIR & TEMPLATE
  // ==========================================
  if (text.startsWith("/pt")) {
    var instansi = (text.match(/Instansi:\s*([^\n]+)/i) || [])[1];
    var syarat = (text.match(/Persyaratan:\s*([\s\S]*?)(?=\nBenefit:|$)/i) || text.match(/Syarat:\s*([\s\S]*?)(?=\nBenefit:|$)/i) || [])[1];
    var benefit = (text.match(/Benefit:\s*([\s\S]*?)(?=\nMulai:|$)/i) || [])[1];
    var mulai = (text.match(/Mulai:\s*([^\n]+)/i) || [])[1];
    var selesai = (text.match(/Selesai:\s*([^\n]+)/i) || [])[1];

    // Jika data tidak lengkap atau hanya mengetik /pt saja
    if (!instansi || !syarat || !benefit || !mulai || !selesai) {
      return sendMessage(chatId, "🤝 *TEMPLATE PARTNERSHIP* 🤝\n\nSalin, isi, dan kirim format ini:\n\n`/pt`\n`Instansi: `\n`Persyaratan: `\n`Benefit: `\n`Mulai: `\n`Selesai: `");
    }
    
    var sheetPt = SpreadsheetApp.openById(sheetId).getSheetByName("Partnership");
    var lastRowPt = sheetPt.getLastRow();
    var nomorUrut = lastRowPt < 2 ? 1 : lastRowPt - 1;
    
    // Urutan Sheet: NO, Instansi, Persyaratan, Benefit, Mulai, Selesai
    sheetPt.appendRow([nomorUrut, instansi.trim(), syarat.trim(), benefit.trim(), mulai.trim(), selesai.trim()]);
    
    return sendMessage(chatId, "🤝 *DATA PARTNERSHIP DICATAT!* 🤝\n\nInstansi: " + instansi.trim() + "\nBenefit:\n" + benefit.trim() + "\n\nDurasi: " + mulai.trim() + " s/d " + selesai.trim());
  }
  
  return ContentService.createTextOutput("OK");
}
// ==========================================
// FUNGSI HELPER BARU (DATABASE & REKAP)
// ==========================================

function cariNamaLengkapDatabase(inputRaw) {
  var sheetData = SpreadsheetApp.openById(sheetId).getSheetByName("Data Pengurus");
  if (!sheetData) return { status: false, msg: "❌ Sheet 'Data Pengurus' tidak ditemukan di Spreadsheet." };
  
  var data = sheetData.getDataRange().getValues();
  var keywords = inputRaw.toLowerCase().split(" ");
  var matches = [];
  
  for (var i = 1; i < data.length; i++) { 
    var barisTeks = data[i].join(" ").toLowerCase(); 
    var isMatch = true;
    for (var k = 0; k < keywords.length; k++) {
      if (barisTeks.indexOf(keywords[k]) === -1) {
        isMatch = false; break;
      }
    }
    if (isMatch) {
      matches.push(data[i][1]); 
    }
  }
  
  if (matches.length === 1) return { status: true, nama: matches[0] };
  if (matches.length > 1) return { status: "multiple", matches: matches };
  return { status: false, msg: "❌ Nama '" + inputRaw + "' tidak terdaftar di database anggota." };
}

function updateRekapDelegasi(namaBaku) {
  var sheetRekap = SpreadsheetApp.openById(sheetId).getSheetByName("Rekap Delegasi");
  if (!sheetRekap) return;
  
  var data = sheetRekap.getDataRange().getValues();
  var foundRow = -1;
  
  // Cari apakah nama sudah ada di sheet (kolom B / index 1)
  for (var i = 2; i < data.length; i++) {
    if (data[i][1] === namaBaku) { 
      foundRow = i + 1; 
      break;
    }
  }
  
  // Jika nama SUDAH ADA, bot tidak perlu repot menghitung matematika.
  // Rumus COUNTIF di Spreadsheet akan mengerjakannya secara otomatis!
  if (foundRow !== -1) {
    return; // Langsung hentikan proses, biarkan Spreadsheet yang bekerja
  } else {
    // Jika nama BELUM ADA, kita buat baris baru
    var lastNo = 0;
    var lastRowPos = 2; 
    
    for (var r = data.length - 1; r >= 2; r--) {
      if (data[r][1] !== "") { 
        lastNo = parseInt(data[r][0]) || 0;
        lastRowPos = r + 1;
        break;
      }
    }
    
    var barisBaru = lastRowPos + 1;
    
    // Tanamkan rumus dinamis, bukan angka mati!
    // Asumsi: Nama ada di Kolom B, dan data delegasi ada di Kolom H sheet Undangan.
    var formulaPoin = '=COUNTIF(Undangan!H:H, "*"&B' + barisBaru + '&"*")';
    
    // Masukkan No urut, Nama, dan Rumus tersebut ke baris baru
    sheetRekap.getRange(barisBaru, 1, 1, 3).setValues([[lastNo + 1, namaBaku, formulaPoin]]);
  }
}

// ==========================================
// FUNGSI HELPER & TRIGGERS LAMA
// ==========================================

function sendMessage(chatId, text) {
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";
  var payload = { "chat_id": String(chatId), "text": text, "parse_mode": "Markdown" };
  var options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
  try { 
    var response = UrlFetchApp.fetch(url, options); 
    var json = JSON.parse(response.getContentText());
    if (!json.ok) {
      console.error("Telegram API Error: " + json.description + " | Text: " + text);
      if (json.description && json.description.indexOf("parse entities") !== -1) {
         delete payload.parse_mode;
         options.payload = JSON.stringify(payload);
         UrlFetchApp.fetch(url, options);
      }
    }
  } catch(e) {
    console.error("HTTP Fetch Error: " + e.message);
  }
}

function prosesDelegasiTag(delegasiString) {
  var arrDelegasi = delegasiString.split(",");
  var mentions = [];
  var dmList = [];
  
  var sheetUser = SpreadsheetApp.openById(sheetId).getSheetByName("User_Bot");
  if (!sheetUser) return { mentionText: "*" + delegasiString + "*", dmList: [] };
  
  var dataUser = sheetUser.getDataRange().getValues();
  
  for (var d = 0; d < arrDelegasi.length; d++) {
    var nama = arrDelegasi[d].trim();
    var foundId = null;
    
    for (var i = 1; i < dataUser.length; i++) {
      if (dataUser[i][1] && nama.toLowerCase().indexOf(String(dataUser[i][1]).toLowerCase()) !== -1) {
         foundId = dataUser[i][0];
         break;
      }
    }
    
    if (foundId) {
       mentions.push("[" + nama + "](tg://user?id=" + foundId + ")");
       dmList.push({ id: foundId, nama: nama });
    } else {
       mentions.push("*" + nama + "*");
    }
  }
  return { mentionText: mentions.join(", "), dmList: dmList };
}

function reminderBelumAdaDelegasi() {
  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
  var data = sheet.getDataRange().getValues();
  var pesan = "";
  
  var hariIni = new Date();
  hariIni.setHours(0,0,0,0); 
  var tahunIni = hariIni.getFullYear();
  
  // Kamus nama hari dalam bahasa Indonesia
  var namaHariArr = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

  for (var i = 1; i < data.length; i++) { 
    var idSurat = data[i][1];
    var uk = data[i][3];
    var kegiatan = data[i][4];
    var waktu = data[i][5];
    var lokasi = data[i][6];
    var delegasi = data[i][7];
    
    if (idSurat !== "" && delegasi === "" && waktu !== "") {
      var tglAcara;
        
      if (waktu.constructor.name === "Date") {
         tglAcara = new Date(waktu);
      } else {
         var waktuTeks = String(waktu).trim();
         var parts = waktuTeks.split(" ");
         var dateParts = parts[0].split(/[-/]/); 
         
         if (dateParts.length >= 2) { 
            tglAcara = new Date(tahunIni, parseInt(dateParts[1]) - 1, parseInt(dateParts[0]));
         }
      }
      
      if (tglAcara && !isNaN(tglAcara.getTime())) {
         // Mengekstrak index hari dan mencocokkannya dengan kamus array
         var hariIndex = tglAcara.getDay();
         var namaHari = namaHariArr[hariIndex];
         
         tglAcara.setHours(0,0,0,0);
         var selisihWaktu = tglAcara.getTime() - hariIni.getTime();
         var selisihHari = Math.ceil(selisihWaktu / (1000 * 3600 * 24));
         
         if (selisihHari >= 0) {
            // Sisipkan variabel namaHari tepat sebelum variabel waktu
            pesan += "🔹 *" + idSurat + "* (" + uk + " - " + kegiatan + ")\n📍 " + namaHari + " " + waktu + " - " + lokasi + "\n\n";
         }
      }
    }
  }
  
  if (pesan !== "") {
    var finalPesan = "🔔 *UNDANGAN KOSONG* 🔔\n\nHalo Tim PR! Undangan berikut masih belum memiliki delegasi:\n\n" + pesan + "Ayo segera ambil slotnya dengan membalas `/a ID_Surat Nama_Kamu`!";
    sendMessage(grupChatId, finalPesan);
  }
}

function reminderDelegasi() {
  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
  var data = sheet.getDataRange().getValues();
  
  var hariIni = new Date();
  hariIni.setHours(0,0,0,0); 
  var tahunIni = hariIni.getFullYear();
  
  var namaHariArr = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  var namaBulanArr = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  for (var i = 1; i < data.length; i++) { 
    var idSurat = data[i][1];
    var uk = data[i][3];
    var kegiatan = data[i][4];
    var waktu = data[i][5]; 
    var lokasi = data[i][6];
    var delegasi = data[i][7];
    
    if (idSurat !== "" && delegasi !== "" && waktu !== "") {
        var tglAcara;
        var jam = "00";
        var menit = "00";
        
        if (waktu instanceof Date) {
           tglAcara = new Date(waktu);
           jam = String(tglAcara.getHours()).padStart(2, '0');
           menit = String(tglAcara.getMinutes()).padStart(2, '0');
        } else {
           var waktuTeks = String(waktu).trim();
           var parts = waktuTeks.split(" ");
           var dateParts = parts[0].split(/[-/]/); 
           
           if (dateParts.length >= 2) { 
              var tParts = parts[1] ? parts[1].replace(/[^0-9:]/g, "").split(":") : ["00", "00"];
              jam = String(tParts[0] || "00").padStart(2, '0');
              menit = String(tParts[1] || "00").padStart(2, '0');
              tglAcara = new Date(tahunIni, parseInt(dateParts[1]) - 1, parseInt(dateParts[0]), parseInt(jam), parseInt(menit));
           }
        }
        
        if (tglAcara && !isNaN(tglAcara.getTime())) {
           var tglAcaraAsli = new Date(tglAcara.getTime()); 
           tglAcara.setHours(0,0,0,0);
           var selisihWaktu = tglAcara.getTime() - hariIni.getTime();
           var selisihHari = Math.ceil(selisihWaktu / (1000 * 3600 * 24));
           
           if (selisihHari < 0) continue; 
           if (selisihHari === 0 && tglAcaraAsli.getTime() < new Date().getTime()) continue; 
           
           if (selisihHari >= 0 && selisihHari <= 2) {
              var labelHari = (selisihHari === 0) ? "🚨 *HARI INI!*" : "⏳ *H-" + selisihHari + "*";
              
              var tglFormat = String(tglAcara.getDate()).padStart(2, '0');
              var namaHari = namaHariArr[tglAcara.getDay()];
              var namaBulan = namaBulanArr[tglAcara.getMonth()];
              var waktuTampil = namaHari + " (" + jam + ":" + menit + " WIB) " + tglFormat + " " + namaBulan;

              var infoDelegasi = prosesDelegasiTag(delegasi);
              var pesanGrup = "⏰ *REMINDER* ⏰\n\n" + labelHari + "\n\nHalo " + infoDelegasi.mentionText + "! Jangan lupa jadwal kegiatan kamu yang semakin dekat:\n\n🔹 *" + kegiatan + "* (" + uk + ")\n📍 " + waktuTampil + " - " + lokasi + "\n\nSemangat bertugas dan jangan lupa kirim foto bukti kehadiran pakai `/f " + idSurat + "` ya! 💅";
              sendMessage(grupChatId, pesanGrup);
              
              for (var d = 0; d < infoDelegasi.dmList.length; d++) {
                  var userTarget = infoDelegasi.dmList[d];
                  var pesanDM = "⏰ *REMINDER PERSONAL* ⏰\n\n" + labelHari + "\n\nHalo *" + userTarget.nama + "*! Ini pengingat langsung dari Monalissa untuk kegiatanmu:\n\n🔹 *" + kegiatan + "* (" + uk + ")\n📍 " + waktuTampil + " - " + lokasi + "\n\nKirim `/f " + idSurat + "` beserta foto ya nanti! 💅";
                  sendMessage(userTarget.id, pesanDM);
              }
           }
        }
    }
  }
}

function rekapBulanan() {
  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
  var data = sheet.getDataRange().getValues();
  
  var hariIni = new Date();
  var bulanIni = hariIni.getMonth(); 
  var tahunIni = hariIni.getFullYear();
  
  // Logika mundur 1 bulan untuk rekap
  var bulanRekap = bulanIni - 1;
  var tahunRekap = tahunIni;  
  if (bulanRekap < 0) {
     bulanRekap = 11; // Desember
     tahunRekap = tahunIni - 1;
  }

  var namaBulanArr = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  var namaBulanRekap = namaBulanArr[bulanRekap];
  
  var pesan = "📊 *REKAP UNDANGAN BULAN " + namaBulanRekap.toUpperCase() + "* 📊\n\nTerima kasih atas kerja kerasnya bulan ini Tim PR! Berikut adalah rekap kegiatan kita:\n\n";
  var count = 0;

  for (var i = 1; i < data.length; i++) {
    var waktuInput = data[i][2]; // Mengambil waktu surat diterima
    var uk = data[i][3];
    var kegiatan = data[i][4];
    var delegasi = data[i][7] || "_(Kosong)_";
    
    if (kegiatan) {
       var tglWaktu;
       if (waktuInput instanceof Date) {
          tglWaktu = waktuInput;
       } else if (typeof waktuInput === 'string') {
          var parts = waktuInput.split(" ")[0].split(/[-/]/);
          if (parts.length >= 2) {
             tglWaktu = new Date(tahunIni, parseInt(parts[1]) - 1, parseInt(parts[0]));
          }
       }
       
       if (tglWaktu && tglWaktu.getMonth() === bulanRekap && tglWaktu.getFullYear() === tahunRekap) {
          pesan += "✅ *" + kegiatan + "* (" + uk + ") - Diwakili: " + delegasi + "\n";
          count++;
       }
    }
  }
  
  if (count === 0) pesan += "_Tidak ada data undangan untuk bulan ini._\n\n";
  pesan += "\nTerus semangat untuk bulan depan! 💪💅";
  
  sendMessage(grupChatId, pesan);
}

// ==========================================
// FUNGSI CALLBACK & EKSTRAKSI LOGIKA BARU
// ==========================================

function handleCallback(callbackQuery) {
  var cbData = callbackQuery.data;
  var messageId = callbackQuery.message.message_id;
  var chatId = callbackQuery.message.chat.id;
  var userIdCallback = callbackQuery.from.id; // User yang memencet tombol
  var parts = cbData.split("|");
  var action = parts[0];
  
  if (action === "DEL_YES" || action === "DEL_NO") {
     // Validasi Admin secara otomatis dari Grup Telegram
     var checkUrl = "https://api.telegram.org/bot" + token + "/getChatMember?chat_id=" + grupChatId + "&user_id=" + userIdCallback;
     var checkResponse = UrlFetchApp.fetch(checkUrl, {muteHttpExceptions: true});
     var checkData = JSON.parse(checkResponse.getContentText());
     var isAdmin = false;
     
     if (checkData.ok) {
         var userStatus = checkData.result.status;
         if (userStatus === "administrator" || userStatus === "creator") {
             isAdmin = true;
         }
     }
     
     if (!isAdmin) {
         UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id + "&text=❌ Akses ditolak. Anda bukan Admin Grup!&show_alert=true");
         return;
     }
     
     var idSurat = parts[1];
     var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
     var dataAll = sheet.getDataRange().getValues();
     var barisDitemukan = -1;
     var delegasi = "";
     
     for (var i = 0; i < dataAll.length; i++) {
        if (dataAll[i][1] === idSurat) { barisDitemukan = i + 1; delegasi = dataAll[i][7]; break; }
     }
     
     if (barisDitemukan !== -1) {
        if (action === "DEL_YES") {
           sheet.getRange(barisDitemukan, 8).setValue(""); // Kosongkan
           var payloadEdit = {
               chat_id: String(chatId),
               message_id: messageId,
               text: "🧹 Delegasi *" + delegasi + "* pada *" + idSurat + "* telah dihapus oleh Admin.",
               parse_mode: "Markdown"
           };
           UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
        } else if (action === "DEL_NO") {
           sheet.getRange(barisDitemukan, 9).setValue("Tanpa Foto (Disetujui Admin)"); 
           var payloadEdit = {
               chat_id: String(chatId),
               message_id: messageId,
               text: "✅ Delegasi *" + delegasi + "* pada *" + idSurat + "* dipertahankan oleh Admin.",
               parse_mode: "Markdown"
           };
           UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
        }
     }
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
     return;
  }
  
  if (action === "DELMP_YES" || action === "DELMP_NO") {
     var checkUrl = "https://api.telegram.org/bot" + token + "/getChatMember?chat_id=" + grupChatId + "&user_id=" + userIdCallback;
     var checkResponse = UrlFetchApp.fetch(checkUrl, {muteHttpExceptions: true});
     var checkData = JSON.parse(checkResponse.getContentText());
     var isAdmin = false;
     if (checkData.ok && (checkData.result.status === "administrator" || checkData.result.status === "creator")) {
         isAdmin = true;
     }
     
     if (!isAdmin) {
         UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id + "&text=❌ Akses ditolak. Anda bukan Admin Grup!&show_alert=true");
         return;
     }
     
     var idMp = parts[1];
     var sheetMp = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart") || SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
     var dataAll = sheetMp.getDataRange().getValues();
     var barisDitemukan = -1;
     var instansi = "";
     
     for (var i = 0; i < dataAll.length; i++) {
        // Kolom kedua (index 1) adalah ID Medpart, kolom keempat (index 3) adalah Instansi
        if (dataAll[i][1] === idMp) { barisDitemukan = i + 1; instansi = dataAll[i][3]; break; }
     }
     
     if (barisDitemukan !== -1) {
        if (action === "DELMP_YES") {
           sheetMp.deleteRow(barisDitemukan);
           var payloadEdit = {
               chat_id: String(chatId),
               message_id: messageId,
               text: "🧹 Data Media Partner *" + instansi + "* (" + idMp + ") telah **DIHAPUS/DIBATALKAN** dari sistem oleh Admin.",
               parse_mode: "Markdown"
           };
           UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
        } else if (action === "DELMP_NO") {
           // Reset Tgl Masuk (kolom 3) ke hari ini agar mendapatkan perpanjangan waktu penuh
           sheetMp.getRange(barisDitemukan, 3).setValue(new Date()); 
           var payloadEdit = {
               chat_id: String(chatId),
               message_id: messageId,
               text: "✅ Data Media Partner *" + instansi + "* (" + idMp + ") **DIPERTAHANKAN**. Tanggal Masuk telah di-reset ulang ke hari ini oleh Admin.",
               parse_mode: "Markdown"
           };
           UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
        }
     }
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
     return;
  }

  // Matikan efek loading di tombol Telegram untuk action lain
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  
  if (action === "DL") {
     var idSuratDicari = parts[1];
     var namaBaku = parts[2];
     prosesDelegasiSheet(chatId, idSuratDicari, namaBaku);
  } else if (action === "DF") {
     var userId = parts[1];
     var namaBaku = parts[2];
     prosesDaftarUser(chatId, userId, namaBaku);
  }
  
  // Hapus tombol setelah diklik (edit pesan)
  var payloadEdit = {
     chat_id: String(chatId),
     message_id: messageId,
     text: "✅ Pilihan nama *" + namaBaku + "* sedang diproses oleh Monalissa... 💅",
     parse_mode: "Markdown"
  };
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
}

function prosesDaftarUser(chatId, userId, namaBaku) {
  var sheetUser = SpreadsheetApp.openById(sheetId).getSheetByName("User_Bot");
  if(!sheetUser) {
    sendMessage(chatId, "❌ Error: Tab 'User_Bot' belum dibuat di Spreadsheet.");
    return;
  }
  
  sheetUser.appendRow([userId, namaBaku]);
  
  var pesanDM = "🎉 *HALO " + namaBaku.toUpperCase() + "!* 🎉\n\nIni adalah pesan otomatis dari Monalissa. Akun Telegram-mu sudah berhasil terhubung dengan database PR UKBA!\n\nMulai sekarang, semua pengingat undangan pribadimu akan masuk langsung ke chat ini. 💅";
  
  var urlDM = "https://api.telegram.org/bot" + token + "/sendMessage";
  var payloadDM = { "chat_id": String(userId), "text": pesanDM, "parse_mode": "Markdown" };
  var optionsDM = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payloadDM), "muteHttpExceptions": true };
  
  var response = UrlFetchApp.fetch(urlDM, optionsDM);
  var jsonResponse = JSON.parse(response.getContentText());
  
  if (jsonResponse.ok) {
     if (String(chatId) !== String(userId)) {
        sendMessage(chatId, "✅ *" + namaBaku + "* berhasil didaftarkan! Cek DM kamu sekarang, Monalissa sudah kirim pesan perkenalan ke sana. 💅");
     }
  } else {
     sendMessage(chatId, "⚠️ *" + namaBaku + "* berhasil didaftarkan di database, *TAPI* Monalissa gagal mengirim DM kepadamu.\n\n*Solusi:* Klik profil bot ini, masuk ke chat pribadi, dan klik tombol **START** (atau ketik /start) agar Monalissa punya izin untuk mengirim pengingat ke DM-mu! 💅");
  }
}

function prosesDelegasiSheet(chatId, idSuratDicari, namaBaku) {
  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
  var dataAll = sheet.getDataRange().getValues();
  var barisDitemukan = -1;
  
  for (var i = 0; i < dataAll.length; i++) {
     if (dataAll[i][1] === idSuratDicari) { barisDitemukan = i + 1; break; }
  }
  
  if (barisDitemukan !== -1) {
     var selDelegasi = sheet.getRange(barisDitemukan, 8);
     var delegasiSekarang = selDelegasi.getValue().toString().trim();
     
     if (delegasiSekarang === "") {
        selDelegasi.setValue(namaBaku);
        updateRekapDelegasi(namaBaku); 
        sendMessage(chatId, "✅ *DELEGASI DICATAT!*\n\n*ID:* " + idSuratDicari + "\n*Delegasi:* " + namaBaku);
     } else {
        if (delegasiSekarang.indexOf(namaBaku) !== -1) {
           sendMessage(chatId, "⚠️ *" + namaBaku + "*, kamu sudah terdaftar di undangan ini!");
        } else {
           var delegasiBaru = delegasiSekarang + ", " + namaBaku;
           selDelegasi.setValue(delegasiBaru);
           updateRekapDelegasi(namaBaku); 
           sendMessage(chatId, "✅ *DELEGASI TAMBAHAN DICATAT!*\n\n*ID:* " + idSuratDicari + "\n*Delegasi Lengkap:*\n" + delegasiBaru);
        }
     }
  } else {
     sendMessage(chatId, "❌ ID Surat *" + idSuratDicari + "* tidak ditemukan.");
  }
}

function hapusDelegasiTanpaBukti() {
  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
  var data = sheet.getDataRange().getValues();
  
  var hariIni = new Date();
  hariIni.setHours(0,0,0,0);
  var tahunIni = hariIni.getFullYear();

  for (var i = 2; i < data.length; i++) {
    var idSurat = data[i][1];
    var kegiatan = data[i][4];
    var waktu = data[i][5];
    var delegasi = data[i][7];
    var buktiFoto = data[i][8]; 
    
    if (idSurat !== "" && delegasi !== "" && waktu !== "") {
       if (String(buktiFoto).trim() === "") {
          var tglAcara;
          if (waktu instanceof Date) {
             tglAcara = new Date(waktu);
          } else {
             var waktuTeks = String(waktu).trim();
             var parts = waktuTeks.split(" ");
             var dateParts = parts[0].split(/[-/]/); 
             if (dateParts.length >= 2) { 
                tglAcara = new Date(tahunIni, parseInt(dateParts[1]) - 1, parseInt(dateParts[0]));
             }
          }
          
          if (tglAcara && !isNaN(tglAcara.getTime())) {
             tglAcara.setHours(0,0,0,0);
             var selisihWaktu = hariIni.getTime() - tglAcara.getTime();
             var selisihHari = Math.floor(selisihWaktu / (1000 * 3600 * 24));
             
             if (selisihHari > 3) {
                var keyboard = [
                    [{ text: "❌ Hapus Delegasi", callback_data: "DEL_YES|" + idSurat }],
                    [{ text: "✅ Pertahankan", callback_data: "DEL_NO|" + idSurat }]
                ];
                var pesanPeringatan = "⚠️ *PERINGATAN DELEGASI* ⚠️\n\nUndangan *" + idSurat + "* (" + kegiatan + ") sudah lewat dari 3 hari, tetapi delegasi *" + delegasi + "* belum mengunggah foto bukti kehadiran.\n\nApakah delegasi di atas harus dihapus atau dipertahankan? _(Hanya Admin yang dapat memencet tombol)_";
                
                var url = "https://api.telegram.org/bot" + token + "/sendMessage";
                var payload = { chat_id: String(grupChatId), text: pesanPeringatan, parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } };
                UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(payload) });
             }
          }
       }
    }
  }
}
function handleCallback(callbackQuery) {
  var cbData = callbackQuery.data;
  var messageId = callbackQuery.message.message_id;
  var chatId = callbackQuery.message.chat.id;
  var userIdCallback = callbackQuery.from.id; // User yang memencet tombol
  var parts = cbData.split("|");
  var action = parts[0];
  
  if (action === "DEL_YES" || action === "DEL_NO") {
     // Validasi Admin secara otomatis dari Grup Telegram
     var checkUrl = "https://api.telegram.org/bot" + token + "/getChatMember?chat_id=" + grupChatId + "&user_id=" + userIdCallback;
     var checkResponse = UrlFetchApp.fetch(checkUrl, {muteHttpExceptions: true});
     var checkData = JSON.parse(checkResponse.getContentText());
     var isAdmin = false;
     
     if (checkData.ok) {
         var userStatus = checkData.result.status;
         if (userStatus === "administrator" || userStatus === "creator") {
             isAdmin = true;
         }
     }
     
     if (!isAdmin) {
         UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id + "&text=❌ Akses ditolak. Anda bukan Admin Grup!&show_alert=true");
         return;
     }
     
     var idSurat = parts[1];
     var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
     var dataAll = sheet.getDataRange().getValues();
     var barisDitemukan = -1;
     var delegasi = "";
     
     for (var i = 0; i < dataAll.length; i++) {
        if (dataAll[i][1] === idSurat) { barisDitemukan = i + 1; delegasi = dataAll[i][7]; break; }
     }
     
     if (barisDitemukan !== -1) {
        if (action === "DEL_YES") {
           sheet.getRange(barisDitemukan, 8).setValue(""); // Kosongkan
           var payloadEdit = {
               chat_id: String(chatId),
               message_id: messageId,
               text: "🧹 Delegasi *" + delegasi + "* pada *" + idSurat + "* telah dihapus oleh Admin.",
               parse_mode: "Markdown"
           };
           UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
        } else if (action === "DEL_NO") {
           sheet.getRange(barisDitemukan, 9).setValue("Tanpa Foto (Disetujui Admin)"); 
           var payloadEdit = {
               chat_id: String(chatId),
               message_id: messageId,
               text: "✅ Delegasi *" + delegasi + "* pada *" + idSurat + "* dipertahankan oleh Admin.",
               parse_mode: "Markdown"
           };
           UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
        }
     }
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
     return;
  }
  
  if (action === "DELMP_YES" || action === "DELMP_NO") {
     var checkUrl = "https://api.telegram.org/bot" + token + "/getChatMember?chat_id=" + grupChatId + "&user_id=" + userIdCallback;
     var checkResponse = UrlFetchApp.fetch(checkUrl, {muteHttpExceptions: true});
     var checkData = JSON.parse(checkResponse.getContentText());
     var isAdmin = false;
     if (checkData.ok && (checkData.result.status === "administrator" || checkData.result.status === "creator")) {
         isAdmin = true;
     }
     
     if (!isAdmin) {
         UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id + "&text=" + encodeURIComponent("❌ Akses ditolak. Anda bukan Admin Grup!") + "&show_alert=true");
         return;
     }
     
     var idMp = parts[1];
     var sheetMp = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart") || SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
     var dataAll = sheetMp.getDataRange().getValues();
     var barisDitemukan = -1;
     var instansi = "";
     
     for (var i = 0; i < dataAll.length; i++) {
        if (dataAll[i][0] === idMp) { barisDitemukan = i + 1; instansi = dataAll[i][1]; break; }
     }
     
     if (barisDitemukan !== -1) {
        if (action === "DELMP_YES") {
           sheetMp.deleteRow(barisDitemukan);
           var payloadEdit = {
               chat_id: String(chatId),
               message_id: messageId,
               text: "🧹 Data Media Partner *" + instansi + "* (" + idMp + ") telah **DIHAPUS** dari sistem oleh Admin.",
               parse_mode: "Markdown"
           };
           UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
        } else if (action === "DELMP_NO") {
           sheetMp.getRange(barisDitemukan, 6).setValue(new Date()); 
           var payloadEdit = {
               chat_id: String(chatId),
               message_id: messageId,
               text: "✅ Data Media Partner *" + instansi + "* (" + idMp + ") **DIPERTAHANKAN**. Waktu tenggang telah di-reset ulang oleh Admin.",
               parse_mode: "Markdown"
           };
           UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
        }
     }
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
     return;
  }


  // Matikan efek loading di tombol Telegram untuk action lain
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  
  if (action === "DL") {
     var idSuratDicari = parts[1];
     var namaBaku = parts[2];
     prosesDelegasiSheet(chatId, idSuratDicari, namaBaku);
  } else if (action === "DF") {
     var userId = parts[1];
     var namaBaku = parts[2];
     prosesDaftarUser(chatId, userId, namaBaku);
  }
  
  // Hapus tombol setelah diklik (edit pesan)
  var payloadEdit = {
     chat_id: String(chatId),
     message_id: messageId,
     text: "✅ Pilihan nama *" + namaBaku + "* sedang diproses oleh Monalissa... 💅",
     parse_mode: "Markdown"
  };
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
}

function prosesDaftarUser(chatId, userId, namaBaku) {
  var sheetUser = SpreadsheetApp.openById(sheetId).getSheetByName("User_Bot");
  if(!sheetUser) {
    sendMessage(chatId, "❌ Error: Tab 'User_Bot' belum dibuat di Spreadsheet.");
    return;
  }
  
  sheetUser.appendRow([userId, namaBaku]);
  
  var pesanDM = "🎉 *HALO " + namaBaku.toUpperCase() + "!* 🎉\n\nIni adalah pesan otomatis dari Monalissa. Akun Telegram-mu sudah berhasil terhubung dengan database PR UKBA!\n\nMulai sekarang, semua pengingat undangan pribadimu akan masuk langsung ke chat ini. 💅";
  
  var urlDM = "https://api.telegram.org/bot" + token + "/sendMessage";
  var payloadDM = { "chat_id": String(userId), "text": pesanDM, "parse_mode": "Markdown" };
  var optionsDM = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payloadDM), "muteHttpExceptions": true };
  
  var response = UrlFetchApp.fetch(urlDM, optionsDM);
  var jsonResponse = JSON.parse(response.getContentText());
  
  if (jsonResponse.ok) {
     if (String(chatId) !== String(userId)) {
        sendMessage(chatId, "✅ *" + namaBaku + "* berhasil didaftarkan! Cek DM kamu sekarang, Monalissa sudah kirim pesan perkenalan ke sana. 💅");
     }
  } else {
     sendMessage(chatId, "⚠️ *" + namaBaku + "* berhasil didaftarkan di database, *TAPI* Monalissa gagal mengirim DM kepadamu.\n\n*Solusi:* Klik profil bot ini, masuk ke chat pribadi, dan klik tombol **START** (atau ketik /start) agar Monalissa punya izin untuk mengirim pengingat ke DM-mu! 💅");
  }
}

function prosesDelegasiSheet(chatId, idSuratDicari, namaBaku) {
  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
  var dataAll = sheet.getDataRange().getValues();
  var barisDitemukan = -1;
  
  for (var i = 0; i < dataAll.length; i++) {
     if (dataAll[i][1] === idSuratDicari) { barisDitemukan = i + 1; break; }
  }
  
  if (barisDitemukan !== -1) {
     var selDelegasi = sheet.getRange(barisDitemukan, 8);
     var delegasiSekarang = selDelegasi.getValue().toString().trim();
     
     if (delegasiSekarang === "") {
        selDelegasi.setValue(namaBaku);
        updateRekapDelegasi(namaBaku); 
        sendMessage(chatId, "✅ *DELEGASI DICATAT!*\n\n*ID:* " + idSuratDicari + "\n*Delegasi:* " + namaBaku);
     } else {
        if (delegasiSekarang.indexOf(namaBaku) !== -1) {
           sendMessage(chatId, "⚠️ *" + namaBaku + "*, kamu sudah terdaftar di undangan ini!");
        } else {
           var delegasiBaru = delegasiSekarang + ", " + namaBaku;
           selDelegasi.setValue(delegasiBaru);
           updateRekapDelegasi(namaBaku); 
           sendMessage(chatId, "✅ *DELEGASI TAMBAHAN DICATAT!*\n\n*ID:* " + idSuratDicari + "\n*Delegasi Lengkap:*\n" + delegasiBaru);
        }
     }
  } else {
     sendMessage(chatId, "❌ ID Surat *" + idSuratDicari + "* tidak ditemukan.");
  }
}

function hapusDelegasiTanpaBukti() {
  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
  var data = sheet.getDataRange().getValues();
  
  var hariIni = new Date();
  hariIni.setHours(0,0,0,0);
  var tahunIni = hariIni.getFullYear();

  for (var i = 2; i < data.length; i++) {
    var idSurat = data[i][1];
    var kegiatan = data[i][4];
    var waktu = data[i][5];
    var delegasi = data[i][7];
    var buktiFoto = data[i][8]; 
    
    if (idSurat !== "" && delegasi !== "" && waktu !== "") {
       if (String(buktiFoto).trim() === "") {
          var tglAcara;
          if (waktu instanceof Date) {
             tglAcara = new Date(waktu);
          } else {
             var waktuTeks = String(waktu).trim();
             var parts = waktuTeks.split(" ");
             var dateParts = parts[0].split(/[-/]/); 
             if (dateParts.length >= 2) { 
                tglAcara = new Date(tahunIni, parseInt(dateParts[1]) - 1, parseInt(dateParts[0]));
             }
          }
          
          if (tglAcara && !isNaN(tglAcara.getTime())) {
             tglAcara.setHours(0,0,0,0);
             var selisihWaktu = hariIni.getTime() - tglAcara.getTime();
             var selisihHari = Math.floor(selisihWaktu / (1000 * 3600 * 24));
             
             if (selisihHari > 3) {
                var keyboard = [
                    [{ text: "❌ Hapus Delegasi", callback_data: "DEL_YES|" + idSurat }],
                    [{ text: "✅ Pertahankan", callback_data: "DEL_NO|" + idSurat }]
                ];
                var infoDelegasi = prosesDelegasiTag(delegasi);
                var pesanPeringatan = "⚠️ *PERINGATAN DELEGASI* ⚠️\n\nUndangan *" + idSurat + "* (" + kegiatan + ") sudah lewat dari 3 hari, tetapi delegasi " + infoDelegasi.mentionText + " belum mengunggah foto bukti kehadiran.\n\nApakah delegasi di atas harus dihapus atau dipertahankan? _(Hanya Admin yang dapat memencet tombol)_";
                
                var url = "https://api.telegram.org/bot" + token + "/sendMessage";
                var payload = { chat_id: String(grupChatId), text: pesanPeringatan, parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } };
                UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(payload) });
                
                // Kirim teguran ke DM masing-masing delegasi
                for (var d = 0; d < infoDelegasi.dmList.length; d++) {
                   var userTarget = infoDelegasi.dmList[d];
                   var pesanTeguranDM = "🚨 *TEGURAN DARI MONALISSA* 🚨\n\nHalo *" + userTarget.nama + "*!\n\nKegiatan *" + kegiatan + "* (" + idSurat + ") sudah berlalu lebih dari 3 hari, tapi kamu belum mengunggah foto bukti kehadiran sama sekali.\n\nAyo segera kirim foto dengan caption `/f " + idSurat + "` ke grup atau balas pesan ini. Jika tidak, keikutsertaan delegasimu akan dihapus oleh Admin! 💅";
                   sendMessage(userTarget.id, pesanTeguranDM);
                }
             }
          }
       }
    }
  }
}

function reminderMedpart() {
  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart") || SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  
  var hariIni = new Date();
  hariIni.setHours(0,0,0,0);
  
  var listBelumSyarat = [];
  var listBelumPoster = [];
  
  for (var i = 1; i < data.length; i++) {
    // Mapping ke tabel 8 kolom: NO(0), ID(1), TglMasuk(2), Instansi(3), Cp(4), TglUpload(5), Bukti(6), Poster(7)
    var idMp = data[i][1];
    var tglMasuk = data[i][2];
    var instansi = data[i][3];
    var cp = data[i][4];
    var tglUpload = String(data[i][5] || "").trim();
    var bukti = String(data[i][6] || "").trim();
    var poster = String(data[i][7] || "").trim();
    
    if (!idMp || !instansi) continue;
    
    var tglMulai = (tglMasuk instanceof Date) ? new Date(tglMasuk.getTime()) : new Date(); 
    tglMulai.setHours(0,0,0,0);
    var selisihHari = Math.floor((hariIni.getTime() - tglMulai.getTime()) / (1000 * 3600 * 24));
    
    var syaratKosong = (bukti === "" || bukti.toLowerCase() === "belum ada" || bukti.toLowerCase() === "menunggu syarat");
    var posterKosong = (poster === "");
    var tglKosong = (tglUpload === "" || tglUpload.toLowerCase() === "menunggu syarat");

    if (syaratKosong) {
      if (selisihHari > 14) {
        var keyboard = [
            [{ text: "❌ Hapus Medpart", callback_data: "DELMP_YES|" + idMp }],
            [{ text: "✅ Tahan Sementara", callback_data: "DELMP_NO|" + idMp }]
        ];
        var pesanHapus = "🚨 *PERINGATAN KRITIS MEDPART* 🚨\n\nInstansi *" + instansi + "* (" + idMp + ") sepertinya *ghosting*!\n\n*Alasan:* Syarat (Link Bukti) sama sekali tidak dipenuhi selama lebih dari 14 hari sejak mendaftar.\n\nApakah antrean Medpart ini harus dihapus dari database? _(Hanya Admin)_";
        var url = "https://api.telegram.org/bot" + token + "/sendMessage";
        var payload = { chat_id: String(grupChatId), text: pesanHapus, parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } };
        UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(payload) });
      } else {
        listBelumSyarat.push("🔹 *" + idMp + "* - " + instansi + " (H+" + selisihHari + ")");
      }
    } else if (posterKosong || tglKosong) {
      if (selisihHari > 17) {
        var keyboard = [
            [{ text: "❌ Batalkan Medpart", callback_data: "DELMP_YES|" + idMp }],
            [{ text: "✅ Tetap Proses", callback_data: "DELMP_NO|" + idMp }]
        ];
        var pesanHapus = "⚠️ *KONFIRMASI MEDPART TERTUNDA* ⚠️\n\nInstansi *" + instansi + "* (" + idMp + ") sudah memenuhi syarat, tapi sudah " + selisihHari + " hari Poster Final belum juga dikirim.\n\nKarena syarat sudah terpenuhi, slot ini tidak dihapus otomatis. Apakah kalian masih ingin memproses instansi ini? _(Hanya Admin)_";
        var url = "https://api.telegram.org/bot" + token + "/sendMessage";
        var payload = { chat_id: String(grupChatId), text: pesanHapus, parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } };
        UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(payload) });
      } else {
        listBelumPoster.push("🔹 *" + idMp + "* - " + instansi + " (H+" + selisihHari + ")");
      }
    }
  }
  
  if (listBelumSyarat.length > 0) {
    sendMessage(grupChatId, "⚠️ *REMINDER SYARAT MEDPART* ⚠️\n\nBeberapa instansi berikut belum melengkapi syarat sejak didaftarkan. Harap segera di-follow up agar statusnya tidak digantung!\n\n" + listBelumSyarat.join("\n"));
  }
  
  if (listBelumPoster.length > 0) {
    sendMessage(grupChatId, "⏳ *REMINDER POSTER MEDPART* ⏳\n\nInstansi berikut sudah memenuhi syarat, tapi Poster Final-nya masih belum diterima. Ayo kejar pihak eksternalnya!\n\n" + listBelumPoster.join("\n"));
  }
}

// ==========================================
// 🤖 FUNGSI AI GEMINI (PEMROSES NATURAL LANGUAGE)
// ==========================================
function extractUndanganWithGemini(textInput) {
  if (!geminiApiKey) {
     return "ERROR: Kunci GEMINI_API_KEY belum dipasang di Script Properties!";
  }
  
  var prompt = "Tugasmu: Analisis pesan berikut dan ubah menjadi SALAH SATU format perintah bot Telegram yang tepat.\n\n" +
               "PILIHAN FORMAT YANG DIIZINKAN:\n" +
               "1. Input Undangan: /i Nama Pengirim, Nama Kegiatan, DD/MM, HH:MM, Lokasi\n" +
               "2. Ambil Delegasi: /a ID_Surat Nama_Kamu\n" +
               "3. Batal Delegasi: /tarik ID_Surat Nama_Kamu\n" +
               "4. Hapus Surat: /hapus ID_Surat\n" +
               "5. Edit Data Undangan/Medpart: /edit ID Kolom NilaiBaru (Kolom Undangan: Pengirim/Kegiatan/Waktu/Lokasi | Kolom Medpart: Instansi/Cp/Tanggal/Bukti)\n" +
               "6. Upload Foto Bukti: /f ID_Surat\n" +
               "7. Input Media Partner: /mp\\nInstansi: NamaInstansi\\nCp: NamaAtauNomor\\nTanggal Upload: DD/MM\\nLink Bukti: LinkGDrive\n" +
               "8. Upload Poster Media Partner: /fmp ID_Medpart\n" +
               "9. Cek Status Medpart: /info medpart\n\n" +
               "ATURAN SUPER KETAT UNTUK INPUT UNDANGAN BARU (/i):\n" +
               "- Kamu HARUS mengekstrak 5 data wajib: (Pengirim, Nama Kegiatan, Tanggal, Jam, Lokasi).\n" +
               "- JIKA ada data yang kurang/tidak disebutkan di pesan asli, JANGAN berikan format /i! Balas dengan: ERROR: Pesan kamu kurang lengkap nih! Tolong sebutkan [sebutkan bagian yang kurang, misal: lokasi acaranya di mana dan jam berapa?] agar Monalissa bisa mencatatnya ke buku tamu 💅\n" +
               "- Kamu sangat cerdas, konversi teks waktu apa pun (misal '25 oktober', 'besok', 'jam setengah 3 sore') menjadi format Tanggal DD/MM (misal 25/10) dan Jam HH:MM (misal 14:30).\n" +
               "- Pastikan 'Nama Pengirim' ditulis HURUF BESAR SEMUA (contoh: UKKPK, BEM).\n" +
               "- Pastikan 'Nama Kegiatan' dan 'Lokasi' menggunakan Huruf Kapital di Awal Kata (Title Case). NAMUN untuk singkatan nama gedung/kampus (seperti MKU, PKM, LP2M, GOR, FIP, FEB, UNP) TETAPKAN SEBAGAI HURUF BESAR. Dan jika ada kata 'lantai', persingkat menjadi 'Lt.' agar rapi.\n\n" +
               "ATURAN UMUM:\n" +
               "- Output HARUS HANYA format baku yang diawali dengan slash (/) jika pesan lengkap.\n" +
               "- JIKA pesan meminta untuk mengecek status, rekap, daftar, atau menanyakan kabar media partner (medpart), gunakan format: /info medpart\n" +
               "- JIKA pesan berisi kalimat mengirimkan/menyerahkan Link GDrive untuk Bukti Syarat Medpart yang sudah ada, gunakan format: /edit ID_Medpart Bukti LinkGdrive-nya\n" +
               "- Jika pesan berisi niat untuk mengunggah 'foto bukti kehadiran undangan', gunakan format /f ID_Surat (tanpa embel-embel lain).\n" +
               "- Jika pesan berisi niat untuk mengunggah 'foto poster media partner/medpart', gunakan format /fmp ID_Medpart.\n" +
               "- Jika pesan berisi informasi awal pendaftaran media partner baru, gunakan format /mp diikuti baris baru (Instansi: ..., Cp: ..., Tanggal Upload: ..., dan Link Bukti: ...). Jika ada yang belum ada, tulis 'Menunggu Syarat'.\n" +
               "- Jika pesan menyatakan ketersediaan hadir/ikut delegasi, gunakan format /a. Ekstrak nama orangnya jika ada, gunakan Huruf Kapital di Awal Kata.\n" +
               "- Jika pesan menyatakan batal/tidak jadi ikut, gunakan format /tarik.\n" +
               "- Jika pesan meminta hapus data, gunakan format /hapus.\n\n" +
               "Pesan masuk: \"" + textInput + "\"";

  var payload = {
    "contents": [{
      "parts": [{"text": prompt}]
    }],
    "generationConfig": {
       "temperature": 0.1
    }
  };
  
  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  // Daftar model yang akan dicoba berurutan jika server sedang kepenuhan (High Demand)
  var modelsToTry = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest"];
  var lastErrorMsg = "";

  for (var i = 0; i < modelsToTry.length; i++) {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelsToTry[i] + ":generateContent?key=" + geminiApiKey;
    
    try {
      var response = UrlFetchApp.fetch(url, options);
      var json = JSON.parse(response.getContentText());
      
      if (json.error) {
         lastErrorMsg = json.error.message;
         continue; 
      }
      
      if (json.candidates && json.candidates.length > 0) {
         var rawOutput = json.candidates[0].content.parts[0].text.trim();
         rawOutput = rawOutput.replace(/```[a-zA-Z]*\n/g, "").replace(/```/g, "").trim();
         return rawOutput;
      }
    } catch(e) {
      return "ERROR TRY-CATCH: " + e.message;
    }
  }
  
  return "ERROR API (Semua server Google sedang penuh/sibuk): " + lastErrorMsg;
}

// ==========================================
// MONITORING & SELF-HEALING (WATCHDOG)
// ==========================================

/**
 * Cek status webhook Telegram secara langsung dari GAS
 */
function checkWebhookStatus() {
  var url = "https://api.telegram.org/bot" + token + "/getWebhookInfo";
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(res.getContentText());
  Logger.log("=== STATUS WEBHOOK TELEGRAM ===");
  Logger.log(JSON.stringify(json, null, 2));
  return json;
}

function resetWebhook(customUrl) {
  // ⬇️ PASTE URL WEB APP BARU ANDA DI ANTARA TANDA KUTIP DI BAWAH INI ⬇️
  var webAppUrl = "PASTE_URL_DISINI";
  
  // (Jangan ubah kode di bawah ini)
  var finalUrl = customUrl ? customUrl : webAppUrl;
  
  if (finalUrl === "PASTE_URL_DISINI" || finalUrl === "") {
    Logger.log("❌ ERROR: Anda belum memasukkan URL Web App yang baru!");
    return;
  }

  // Hapus webhook lama dan bersihkan antrean yang nyangkut
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/deleteWebhook?drop_pending_updates=true", { muteHttpExceptions: true });
  
  // Pasang webhook baru
  var url = "https://api.telegram.org/bot" + token + "/setWebhook?url=" + encodeURIComponent(finalUrl);
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  
  Logger.log("=== STATUS RESET WEBHOOK ===");
  Logger.log(res.getContentText());
}

/**
 * Watchdog / Auto-Healer Trigger:
 * Jalankan fungsi ini otomatis via Trigger waktu (misal setiap 5 atau 10 menit).
 * Jika mendeteksi webhook stuck 302 atau antrean menumpuk > 3, akan otomatis di-reset.
 */
function autoHealWebhook() {
  try {
    var info = checkWebhookStatus();
    if (!info.ok || !info.result) return;
    
    var pendingCount = info.result.pending_update_count || 0;
    var lastError = info.result.last_error_message || "";
    var currentUrl = info.result.url || "";
    
    var isStuck = pendingCount > 3 || lastError.indexOf("302") !== -1 || lastError.indexOf("Wrong response") !== -1;
    
    if (isStuck && currentUrl) {
      Logger.log("⚠️ Terdeteksi antrean macet: " + pendingCount + " pending updates. Error: " + lastError);
      resetWebhook(currentUrl);
      
      // Kirim notifikasi darurat ke grup atau admin jika grupChatId disetel
      if (grupChatId) {
        sendMessage(grupChatId, "🛠️ *Auto-Healer Monalissa:*\nTerdeteksi antrean webhook tersendat (" + pendingCount + " antrean / " + lastError + ").\n\nSistem telah me-reset antrean secara otomatis dan bot sudah aktif kembali! 💅");
      }
    } else {
      Logger.log("✅ Webhook sehat. Pending updates: " + pendingCount);
    }
  } catch (err) {
    console.error("Gagal menjalankan autoHealWebhook: " + err.message);
  }
}
