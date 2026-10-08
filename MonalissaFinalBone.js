var scriptProperties = PropertiesService.getScriptProperties();
var token = scriptProperties.getProperty('TELEGRAM_TOKEN'); 
var sheetId = scriptProperties.getProperty('SHEET_ID'); 
var grupChatId = scriptProperties.getProperty('GRUP_CHAT_ID'); 
var folderId = scriptProperties.getProperty('FOLDER_ID'); 
var geminiApiKey = scriptProperties.getProperty('GEMINI_API_KEY'); 
var webAppUrlProperty = scriptProperties.getProperty('WEBHOOK_URL'); 
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

function formatBulletPoints(text) {
  if (!text) return "";
  var baris = text.split(/\n+/);
  var hasil = [];
  for (var i = 0; i < baris.length; i++) {
     var str = baris[i].trim();
     if (str.length === 0) continue;
     
     // Hapus karakter awal yang tidak rapi (dash, bintang, nomor berurutan dll)
     str = str.replace(/^[\-\*\•\>]+/, "").trim();
     str = str.replace(/^\d+[\.\)]+/, "").trim(); 
     
     if (str.length > 0) {
        // Kapital huruf pertama saja untuk kerapian ekstra
        str = str.charAt(0).toUpperCase() + str.slice(1);
        hasil.push("• " + str);
     }
  }
  return hasil.join("\n");
}

function simpanFileKeDrive(fileIdTelegram, subFolderName) {
  try {
      var fileDataUrl = "https://api.telegram.org/bot" + token + "/getFile?file_id=" + fileIdTelegram;
      var response = UrlFetchApp.fetch(fileDataUrl);
      var result = JSON.parse(response.getContentText()).result;
      if (!result) return null;
      
      var filePath = result.file_path;
      var downloadUrl = "https://api.telegram.org/file/bot" + token + "/" + filePath;
      var blob = UrlFetchApp.fetch(downloadUrl).getBlob();
      
      var mainFolder = DriveApp.getFolderById(folderId);
      var folderTujuan = mainFolder;
      
      // Jika ada nama subfolder, cari atau buat otomatis
      if (subFolderName) {
          var folderIter = mainFolder.getFoldersByName(subFolderName);
          if (folderIter.hasNext()) {
              folderTujuan = folderIter.next();
          } else {
              folderTujuan = mainFolder.createFolder(subFolderName);
          }
      }
      
      var savedFile = folderTujuan.createFile(blob);
      savedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      return "https://drive.google.com/uc?export=view&id=" + savedFile.getId();
  } catch(e) {
      Logger.log("Gagal simpan file: " + e.message);
      return null;
  }
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) return;
  
  try {
    var update = JSON.parse(e.postData.contents);
    processUpdate(update);
  } catch (error) {
    console.error("Terjadi error saat memproses update: " + error.message);
  }
  
  // HAPUS return ContentService.createTextOutput("OK"); karena itu membuat GAS merespons 302 Redirect!
  // Biarkan kosong (return undefined), GAS otomatis me-return 200 OK bersih.
  return;
}

function processUpdate(update) {
  
  if (update.callback_query) {
    handleCallback(update.callback_query);
    return;
  }
  
  var msg = update.message;
  
  if (!msg) return;

  var chatId = msg.chat.id;
  var text = msg.text || msg.caption || ""; 
  var teksLower = text.toLowerCase().trim();
  var userId = msg.from ? msg.from.id : null;
  var isPrivateChat = (msg.chat.type === "private");
  
  // Normalisasi command jika dipanggil via menu pop-up di grup (contoh: /info@UKBAPR_Bot -> /info)
  if (text.startsWith("/")) {
     var parts = text.split(" ");
     var cmdPart = parts[0];
     if (cmdPart.indexOf("@") !== -1) {
        parts[0] = cmdPart.split("@")[0];
        text = parts.join(" ");
     }
  }
  
  // ==========================================
  // 🔐 GERBANG VERIFIKASI CHAT PRIBADI (DM)
  // ==========================================
  if (isPrivateChat && userId) {
    var isExemptCmd = (teksLower === "/start" || teksLower === "hey" || text.startsWith("/daftar ") || text === "/cekid");
    if (!isExemptCmd) {
      var verifikasi = verifikasiMember(userId);
      if (!verifikasi.verified) {
        sendMessage(chatId, verifikasi.msg);
        return;
      }
    }
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
        teksLower = text.toLowerCase().trim(); // Update teksLower juga agar if statement di bawahnya berfungsi!
        sendMessage(chatId, "⚙️ Mengeksekusi Perintah ✨\n`" + text + "`");
     } else {
        return sendMessage(chatId, "❌ Maaf, AI Monalissa gagal merangkai format perintahnya.\n\n*Bocoran Jawaban AI:* " + (hasilExtract || "Kosong/Gagal Connect"));
     }
  }

  // ==========================================
  // 🍀 WIZARD MENU: INTERCEPT TOMBOL & STATE
  // ==========================================
  // Cek apakah user sedang dalam proses wizard (state machine) atau menekan tombol menu
  if (msg.from && msg.from.id) {
    var wizardHandled = processWizardInput(chatId, msg.from.id, text, msg.message_id, msg);
    if (wizardHandled) return;
  }

  // 1. KOTAK PANDUAN (/start & /tutor) & GATEWAY DM
  if (teksLower === "/start" || teksLower === "hey") {
    
    if (isPrivateChat) {
       var cekGrup = cekMemberGrup(userId);
       if (!cekGrup.isMember) {
          return sendMessage(chatId, "❌ Maaf, kamu tidak terdeteksi sebagai anggota Grup PR UKBA. Akses ditolak! 💅");
       }
       
       var dataUserVerif = verifikasiMember(userId);
       if (!dataUserVerif.verified) {
          return sendMessage(chatId, "👋 Halo! Kamu sudah terdeteksi sebagai anggota Grup PR, tapi Monalissa belum tahu namamu.\n\nSilakan daftarkan dirimu dengan mengetik:\n`/daftar Nama Lengkap Kamu`\n_(Pastikan sesuai dengan SK Pengurus)_ 💅");
       }
       
       var menuUtamaKbd = [
          [{"text": "🏢 Pekerjaan"}, {"text": "📊 Informasi"}]
       ];
       if (dataUserVerif.isAdmin) {
          menuUtamaKbd.push([{"text": "🛠️ Admin"}]);
       }
       
       var cloverKeyboard = {
         "keyboard": menuUtamaKbd,
         "resize_keyboard": true,
         "one_time_keyboard": false
       };
       sendMessage(chatId, "Halo *" + dataUserVerif.nama + "*! Kenalin, aku *Monalissa* 💅, asisten digital 24 jam kebanggaan divisi PR UKBA.\n\nKetik `/tutor` kalau kamu butuh panduan, atau navigasi langsung lewat menu di bawah ini!\n\n🍀 _Kamu juga bisa pakai tombol akses cepat (clover) kapan saja!_", cloverKeyboard);
       kirimMenuUtama(chatId, "Selamat datang di *Menu Interaktif Monalissa*! 💅\nSilakan pilih menu utama di bawah ini:", dataUserVerif.isAdmin);
       return; 
    } else {
       // Di Grup, tidak merespon start
       return;
    }
  }

  // 1b. DIRECT CLOVER MENU HANDLER
  if (isPrivateChat && (text === "🏢 Pekerjaan" || text === "📊 Informasi" || text === "🛠️ Admin")) {
     var cekGrup = cekMemberGrup(userId);
     if (!cekGrup.isMember) return sendMessage(chatId, "❌ Maaf, kamu tidak terdeteksi sebagai anggota Grup PR UKBA. Akses ditolak! 💅");
     
     var dataUserVerif = verifikasiMember(userId);
     if (!dataUserVerif.verified) return sendMessage(chatId, "👋 Halo! Kamu sudah terdeteksi sebagai anggota Grup PR, tapi Monalissa belum tahu namamu.\n\nSilakan daftarkan dirimu dengan mengetik:\n`/daftar Nama Lengkap Kamu`\n_(Pastikan sesuai dengan SK Pengurus)_ 💅");
     
     if (text === "🏢 Pekerjaan") {
         var textBaru = "🏢 *MODUL PEKERJAAN*\nSilakan pilih modul yang ingin dikerjakan:";
         var keyboard = { inline_keyboard: [
             [{"text": "📩 Undangan", "callback_data": "NAV_PEKERJAAN_UNDANGAN"}, {"text": "🤝 Media Partner", "callback_data": "NAV_PEKERJAAN_MEDPART"}],
             [{"text": "💰 Sponsorship", "callback_data": "NAV_PEKERJAAN_SPONSOR"}, {"text": "🔗 Partnership", "callback_data": "NAV_PEKERJAAN_PARTNER"}],
             [{"text": "🔙 Menu Utama", "callback_data": "MENU_KEMBALI"}]
         ]};
         var botMsgId = sendMessage(chatId, textBaru, keyboard);
         if(botMsgId) CacheService.getScriptCache().put("LAST_MENU_" + chatId, String(botMsgId), 21600);
     } else if (text === "📊 Informasi") {
         var textBaru = "📊 *PUSAT INFORMASI*\nSilakan pilih modul informasi yang ingin dilihat:";
         var keyboard = { inline_keyboard: [
             [{"text": "📩 Undangan", "callback_data": "NAV_INFO_UNDANGAN"}],
             [{"text": "🤝 Media Partner", "callback_data": "NAV_INFO_MEDPART"}],
             [{"text": "💰 Sponsorship", "callback_data": "NAV_INFO_SPONSOR"}],
             [{"text": "🔗 Partnership", "callback_data": "NAV_INFO_PARTNER"}],
             [{"text": "🔙 Menu Utama", "callback_data": "MENU_KEMBALI"}]
         ]};
         var botMsgId = sendMessage(chatId, textBaru, keyboard);
         if(botMsgId) CacheService.getScriptCache().put("LAST_MENU_" + chatId, String(botMsgId), 21600);
     } else if (text === "🛠️ Admin") {
         if (!dataUserVerif.isAdmin) return sendMessage(chatId, "❌ Maaf, kamu bukan Admin Grup PR UKBA. Akses ditolak! 💅");
         var textBaru = "🛠️ *PANEL ADMIN*\nSilakan pilih menu khusus Admin:";
         var keyboard = { inline_keyboard: [
             [{"text": "🗑️ Hapus Data", "callback_data": "MENU_ADMIN_HAPUS"}, {"text": "📢 Broadcast", "callback_data": "MENU_ADMIN_BROADCAST"}],
             [{"text": "🔙 Menu Utama", "callback_data": "MENU_KEMBALI"}]
         ]};
         var botMsgId = sendMessage(chatId, textBaru, keyboard);
         if(botMsgId) CacheService.getScriptCache().put("LAST_MENU_" + chatId, String(botMsgId), 21600);
     }
     return;
  }


  if (text === "/cekid") {
    sendMessage(chatId, "ID untuk chat ini adalah:\n`" + chatId + "`\n\nSilakan copy angka di atas dan masukkan persis seperti itu ke dalam nilai GRUP_CHAT_ID di Script Properties!");
    return;
  }

  if (teksLower === "/clearmenu") {
     var removeKbd = { "remove_keyboard": true };
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", { 
         method: "post", 
         contentType: "application/json", 
         payload: JSON.stringify({ 
             chat_id: String(chatId), 
             text: "✅ Menu lama berhasil dibersihkan dari grup ini.", 
             reply_markup: removeKbd 
         }) 
     });
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
    handleInfoCommand(chatId, text.toLowerCase().trim());
    return;
  }
  /*
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
  */
  
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
    kirimBalasanGanda(chatId, balasan);
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
     var headerRows = 2; // Undangan dan Medpart sama-sama pakai 2 baris (Title & Header)
     
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
        
        // Update Penomoran Otomatis (Kolom NO) dan ID (Kolom ID)
        var lastRow = sheet.getLastRow();
        var numRows = lastRow - headerRows; 
        if (numRows > 0) {
           var newNumbers = [];
           var newIDs = [];
           var prefix = isMedpart ? "M" : "U";
           for (var r = 1; r <= numRows; r++) {
              newNumbers.push([r]);
              newIDs.push([prefix + String(r).padStart(2, '0')]);
           }
           sheet.getRange(headerRows + 1, 1, numRows, 1).setValues(newNumbers);
           sheet.getRange(headerRows + 1, 2, numRows, 1).setValues(newIDs);
        }
        
        var jenis = isMedpart ? "Media Partner" : "Undangan";
        kirimBalasanGanda(chatId, "✅ Data " + jenis + " *" + idHapus + "* berhasil dihapus secara permanen dan penomoran (NO) telah dirapikan kembali. 💅");
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
        kirimBalasanGanda(chatId, "✅ Data " + jenis + " *" + idEdit + "* berhasil diubah!\n\n*Kolom:* " + kolomEdit + "\n*Nilai Baru:* " + nilaiBaru + " 💅");
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
        kirimBalasanGanda(chatId, "✅ Delegasi *" + namaBaku + "* berhasil ditarik dari undangan *" + idSuratTarik + "*. 💅\n\n*Sisa Delegasi:* " + (delegasiBaru === "" ? "_(Kosong)_" : delegasiBaru));
     } else {
        sendMessage(chatId, "❌ ID Surat *" + idSuratTarik + "* tidak ditemukan.");
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
      var balasan = "📸 *Poster Media Partner Berhasil Disimpan!*\n\nKerja bagus! Poster final untuk " + idMpFoto + " sudah diamankan oleh Monalissa.\n\n_Pastikan kamu segera meneruskan (forward) pesan berisi poster ini ke Divisi Design and Media ya!_ 💅";
      sendMessage(chatId, balasan);
      if (grupChatId && String(chatId) !== String(grupChatId)) {
          sendPhoto(grupChatId, fileIdTelegram, balasan);
      }
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
    
    kirimBalasanGanda(chatId, "✅ *DATA MEDIA PARTNER DICATAT!* 💅\n\n*ID Medpart:* " + newId + "\n*Instansi:* " + instansiRapi + "\n*Tanggal Upload:* " + tglFixed + "\n\n_Catatan:_\n1. Jika Link GDrive Bukti Syarat (Follow & Like) sudah dikirim oleh mereka, setor ke AI dengan bilang: *'Ini link bukti syarat buat " + newId + " https://drive...'*.\n2. Jika nanti Poster Final sudah direvisi, baru upload fotonya dengan caption `/fmp " + newId + "` ya!");
    return;
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
    kirimBalasanGanda(chatId, "💰 *DATA SPONSORSHIP DICATAT!* 💰\n\nInstansi: " + instansi.trim() + "\nBenefit:\n" + benefit.trim());
    return;
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
    
    kirimBalasanGanda(chatId, "🤝 *DATA PARTNERSHIP DICATAT!* 🤝\n\nInstansi: " + instansi.trim() + "\nBenefit:\n" + benefit.trim() + "\n\nDurasi: " + mulai.trim() + " s/d " + selesai.trim());
    return;
  }
  
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

function verifikasiMember(userId) {
  var cache = CacheService.getScriptCache();
  var cachedResult = cache.get("VERIFIED_" + userId);
  
  if (cachedResult) {
    try { return JSON.parse(cachedResult); } catch(e) {}
  }
  
  // Cek 1: Apakah user terdaftar di User_Bot?
  var sheetUser = SpreadsheetApp.openById(sheetId).getSheetByName("User_Bot");
  if (!sheetUser) return { verified: false, msg: "❌ Database User_Bot tidak ditemukan. Hubungi Admin.", isAdmin: false };
  
  var dataUser = sheetUser.getDataRange().getValues();
  var namaUser = "";
  var found = false;
  
  for (var i = 1; i < dataUser.length; i++) {
    if (String(dataUser[i][0]) === String(userId)) {
      found = true;
      namaUser = dataUser[i][1] || "";
      break;
    }
  }
  
  if (!found) {
    return { verified: false, msg: "❌ Kamu belum terdaftar di sistem Monalissa.\n\nKetik `/daftar NamaLengkap` untuk mendaftar.\n_(Nama harus sesuai database pengurus)_", isAdmin: false };
  }
  
  // Cek 2: Apakah user masih member Grup PR?
  var cekGrup = cekMemberGrup(userId);
  if (!cekGrup.isMember) {
    return { verified: false, msg: "❌ Kamu bukan anggota Grup PR UKBA. Hubungi Admin untuk bergabung.", isAdmin: false };
  }
  
  var result = { verified: true, nama: namaUser, isAdmin: cekGrup.isAdmin };
  cache.put("VERIFIED_" + userId, JSON.stringify(result), 21600);
  return result;
}

function cekMemberGrup(userId) {
  if (!grupChatId) return { isMember: false, isAdmin: false };
  
  var checkUrl = "https://api.telegram.org/bot" + token + "/getChatMember?chat_id=" + grupChatId + "&user_id=" + userId;
  var checkResponse = UrlFetchApp.fetch(checkUrl, {muteHttpExceptions: true});
  var checkData = JSON.parse(checkResponse.getContentText());
  
  if (!checkData.ok) return { isMember: false, isAdmin: false };
  
  var status = checkData.result.status;
  if (status === "left" || status === "kicked") {
    return { isMember: false, isAdmin: false };
  }
  
  var isAdmin = (status === "administrator" || status === "creator");
  return { isMember: true, isAdmin: isAdmin };
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

function kirimBalasanGanda(chatId, text) {
  sendMessage(chatId, text);
  if (grupChatId && String(chatId) !== String(grupChatId)) {
    sendMessage(grupChatId, text);
  }
}

function sendMessage(chatId, text, replyMarkup) {
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";
  var payload = { "chat_id": String(chatId), "text": text, "parse_mode": "Markdown" };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  var options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
  try { 
    var response = UrlFetchApp.fetch(url, options); 
    var json = JSON.parse(response.getContentText());
    if (!json.ok) {
      console.error("Telegram API Error: " + json.description + " | Text: " + text);
      if (json.description && json.description.indexOf("parse entities") !== -1) {
         delete payload.parse_mode;
         options.payload = JSON.stringify(payload);
         var response2 = UrlFetchApp.fetch(url, options);
         var json2 = JSON.parse(response2.getContentText());
         if (json2.ok) return json2.result.message_id;
      }
    } else {
      return json.result.message_id;
    }
  } catch(e) {
    console.error("HTTP Fetch Error: " + e.message);
  }
  return null;
}

function sendPhoto(chatId, photoUrlOrFileId, caption, replyMarkup) {
  var url = "https://api.telegram.org/bot" + token + "/sendPhoto";
  var payload = { "chat_id": String(chatId), "photo": photoUrlOrFileId, "caption": caption, "parse_mode": "Markdown" };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  var options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
  try {
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());
    if (json.ok) return json.result.message_id;
  } catch(e) {}
  return null;
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
// (Fungsi-fungsi callback dan helper ada di bawah, setelah reminderMedpart)
// ==========================================
function handleCallback(callbackQuery) {
  var cbData = callbackQuery.data;
  var messageId = callbackQuery.message.message_id;
  var chatId = callbackQuery.message.chat.id;
  var userIdCallback = callbackQuery.from.id; // User yang memencet tombol
  var parts = cbData.split("|");
  var action = parts[0];
  
  if (action === "WIZ_SKIP_INPUT") {
      var cache = CacheService.getScriptCache();
      var state = cache.get("WIZ_STATE_" + userIdCallback);
      if (state) {
          var mockMsg = {text: "TBA", from: {id: userIdCallback}};
          processWizardInput(chatId, userIdCallback, "TBA", null, mockMsg);
          UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id + "&text=" + encodeURIComponent("Diisi otomatis: TBA"));
      } else {
          UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id + "&text=" + encodeURIComponent("Sesi sudah berakhir."));
      }
      return;
  }
  
  if (action.startsWith("NAV_") || action === "MENU_KEMBALI" || action === "ACTION_INFO") {
     var cache = CacheService.getScriptCache();
     cache.remove("WIZ_STATE_" + userIdCallback);
     clearWizardMessages(chatId, userIdCallback, messageId);
  }
  
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
            
            var headerRows = 2;
            var lastRow = sheetMp.getLastRow();
            var numRows = lastRow - headerRows; 
            if (numRows > 0) {
               var newNumbers = [];
               var newIDs = [];
               for (var r = 1; r <= numRows; r++) {
                  newNumbers.push([r]);
                  newIDs.push(["M" + String(r).padStart(2, '0')]);
               }
               sheetMp.getRange(headerRows + 1, 1, numRows, 1).setValues(newNumbers);
               sheetMp.getRange(headerRows + 1, 2, numRows, 1).setValues(newIDs);
            }
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


  if (action === "MENU_INPUT_UNDANGAN") {
    var textBaru = "Siyapp! Mari kita buat undangan baru. ✍️\n\nSiapa *Nama Pengirim* undangannya?\n_(Contoh: BEM, UKKPK, LP2M)_";
    var keyboard = { "inline_keyboard": [[{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_UNDANGAN"}]] };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    
    var cache = CacheService.getScriptCache();
    cache.put("WIZ_STATE_" + userIdCallback, "ISI_PENGIRIM", 600);
    trackMsg(userIdCallback, messageId); 
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_INPUT_MEDPART") {
    var textBaru = "Siyapp! Mari kita input Medpart. ✍️\n\nApa *Nama Instansi/Organisasi* pengaju Medpart?";
    var keyboard = { "inline_keyboard": [[{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_MEDPART"}]] };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    
    var cache = CacheService.getScriptCache();
    cache.put("WIZ_STATE_" + userIdCallback, "MEDPART_INSTANSI", 600);
    trackMsg(userIdCallback, messageId);
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_INPUT_SP") {
    var textBaru = "Siyapp! Mari kita catat data Sponsorship. ✍️\n\nApa *Nama Instansi / Sponsor*?";
    var keyboard = { "inline_keyboard": [[{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_SPONSOR"}]] };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    
    var cache = CacheService.getScriptCache();
    cache.put("WIZ_STATE_" + userIdCallback, "SP_INSTANSI", 600);
    trackMsg(userIdCallback, messageId);
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_INPUT_PT") {
    var textBaru = "Siyapp! Mari kita catat data Partnership. ✍️\n\nApa *Nama Instansi / Partner*?";
    var keyboard = { "inline_keyboard": [[{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_PARTNER"}]] };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    
    var cache = CacheService.getScriptCache();
    cache.put("WIZ_STATE_" + userIdCallback, "PT_INSTANSI", 600);
    trackMsg(userIdCallback, messageId);
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_CEK_JADWAL") {
    var textBaru = "📆 *PILIH BULAN REKAP*\nSilakan pilih bulan untuk melihat rekap undangan:";
    var keyboard = { "inline_keyboard": [
        [{"text": "Jan", "callback_data": "ACTION_INFO|bulan|januari"}, {"text": "Feb", "callback_data": "ACTION_INFO|bulan|februari"}, {"text": "Mar", "callback_data": "ACTION_INFO|bulan|maret"}],
        [{"text": "Apr", "callback_data": "ACTION_INFO|bulan|april"}, {"text": "Mei", "callback_data": "ACTION_INFO|bulan|mei"}, {"text": "Jun", "callback_data": "ACTION_INFO|bulan|juni"}],
        [{"text": "Jul", "callback_data": "ACTION_INFO|bulan|juli"}, {"text": "Agu", "callback_data": "ACTION_INFO|bulan|agustus"}, {"text": "Sep", "callback_data": "ACTION_INFO|bulan|september"}],
        [{"text": "Okt", "callback_data": "ACTION_INFO|bulan|oktober"}, {"text": "Nov", "callback_data": "ACTION_INFO|bulan|november"}, {"text": "Des", "callback_data": "ACTION_INFO|bulan|desember"}],
        [{"text": "🔙 Kembali", "callback_data": "NAV_INFO_UNDANGAN"}]
    ] };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "ACTION_INFO") {
     var subAction = parts[1];
     var detailAction = parts.length > 2 ? parts[2] : "";
     
     clearWizardMessages(chatId, userIdCallback);
     
     var infoText = "/info";
     if (subAction === "semua") infoText = "/info semua";
     else if (subAction === "bulan") {
         if (detailAction !== "") infoText = "/info bulan " + detailAction;
         else infoText = "/info bulan";
     }
     else if (subAction === "medpart") infoText = "/info medpart";
     
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/deleteMessage", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId }), muteHttpExceptions: true });
     
     handleInfoCommand(chatId, infoText);
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MEDPART_EDIT") {
     var idMp = parts[1];
     var textBaru = "⚙️ *Edit Media Partner " + idMp + "*\n\nBagian mana yang ingin kamu lengkapi atau ubah?";
     var keyboard = { inline_keyboard: [
         [{ text: "🔗 Syarat (Link Bukti)", callback_data: "MEDPART_SET|SYARAT|" + idMp }],
         [{ text: "🖼️ Poster Final (Foto)", callback_data: "MEDPART_SET|POSTER|" + idMp }],
         [{ text: "🗓️ Tanggal Upload", callback_data: "MEDPART_SET|TGL|" + idMp }],
         [{ text: "🔙 Batal", callback_data: "ACTION_INFO|medpart" }]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MEDPART_SET") {
     var field = parts[1];
     var idMp = parts[2];
     
     var textBaru = "";
     var state = "";
     
     if (field === "SYARAT") {
        textBaru = "🔗 Silakan kirimkan *Link Google Drive* (atau teks bukti) untuk syarat " + idMp + ".";
        state = "EDIT_MP_SYARAT|" + idMp;
     } else if (field === "POSTER") {
        textBaru = "🖼️ Silakan kirimkan *Foto Poster Final* untuk " + idMp + " (Wajib berupa gambar ya!).";
        state = "EDIT_MP_POSTER|" + idMp;
     } else if (field === "TGL") {
        textBaru = "🗓️ Silakan ketik *Tanggal Upload* baru untuk " + idMp + " (Contoh: 15/11).";
        state = "EDIT_MP_TGL|" + idMp;
     }
     
     var keyboard = { inline_keyboard: [[{ text: "🔙 Batal", callback_data: "MEDPART_EDIT|" + idMp }]]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     
     var cache = CacheService.getScriptCache();
     cache.put("WIZ_STATE_" + userIdCallback, state, 600);
     trackMsg(userIdCallback, messageId);
     
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_DAFTAR_DELEGASI") {
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
    var data = sheet.getDataRange().getValues();
    var buttons = [];
    var hariIni = new Date();
    hariIni.setHours(0,0,0,0);
    var tahunIni = hariIni.getFullYear();
    
    for(var i = 2; i < data.length; i++) {
        var idSurat = data[i][1];
        var uk = data[i][3];
        var waktu = data[i][5];
        var delegasi = data[i][7] ? String(data[i][7]).trim() : "";
        if (idSurat && waktu) {
            var tglAcara;
            if (waktu instanceof Date) tglAcara = new Date(waktu);
            else {
               var parts = String(waktu).trim().split(" ")[0].split(/[-/]/);
               if(parts.length >= 2) tglAcara = new Date(tahunIni, parseInt(parts[1])-1, parseInt(parts[0]));
            }
            if (tglAcara) {
                tglAcara.setHours(0,0,0,0);
                if (tglAcara.getTime() >= hariIni.getTime()) {
                    buttons.push([{"text": "📌 " + idSurat + " - " + uk, "callback_data": "DELEGASI|" + idSurat}]);
                }
            }
        }
    }
    
    var textBaru = "📋 *PILIH UNDANGAN MENDATANG*\nSilakan klik undangan yang ingin kamu hadiri:";
    if (buttons.length === 0) textBaru = "✨ Wah, tidak ada undangan kosong di masa depan!";
    
    buttons.push([{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_UNDANGAN"}]);
    var keyboard = { "inline_keyboard": buttons };
    
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "DELEGASI") {
    var idSurat = parts[1];
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
    var data = sheet.getDataRange().getValues();
    var detail = idSurat;
    for(var i = 2; i < data.length; i++) {
       if(data[i][1] === idSurat) {
          detail = data[i][1] + " " + data[i][3] + ", " + data[i][4] + ", " + String(data[i][5]).trim() + ", " + data[i][6];
          break;
       }
    }
    var textBaru = "✨ Kamu memilih: *" + detail + "*\n\n📝 *Mendaftarkan delegasi...*\nSilakan ketikkan *Nama Lengkap* kamu di chat ini:";
    var keyboard = { "inline_keyboard": [[{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_UNDANGAN"}]] };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    
    var cache = CacheService.getScriptCache();
    cache.put("WIZ_STATE_" + userIdCallback, "DELEGASI_NAMA", 600);
    cache.put("WIZ_DELEGASI_ID_" + userIdCallback, idSurat, 600);
    trackMsg(userIdCallback, messageId);
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_KEMBALI") {
    var isAdmin = cekMemberGrup(userIdCallback).isAdmin;
    var textBaru = "Selamat datang di *Menu Interaktif Monalissa*! 💅\nSilakan pilih menu utama di bawah ini:";
    var inlineKbd = [
        [{"text": "🏢 Pekerjaan", "callback_data": "NAV_PEKERJAAN"}, {"text": "📊 Informasi", "callback_data": "NAV_INFORMASI"}]
    ];
    if (isAdmin) {
        inlineKbd.push([{"text": "🛠️ Admin", "callback_data": "NAV_ADMIN"}]);
    }
    
    var keyboard = { "inline_keyboard": inlineKbd };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  // --- NAVIGASI LEVEL 1 ---
  if (action === "NAV_PEKERJAAN") {
     var textBaru = "🏢 *MODUL PEKERJAAN*\nSilakan pilih modul yang ingin dikerjakan:";
     var keyboard = { inline_keyboard: [
         [{"text": "📩 Undangan", "callback_data": "NAV_PEKERJAAN_UNDANGAN"}, {"text": "🤝 Media Partner", "callback_data": "NAV_PEKERJAAN_MEDPART"}],
         [{"text": "💰 Sponsorship", "callback_data": "NAV_PEKERJAAN_SPONSOR"}, {"text": "🔗 Partnership", "callback_data": "NAV_PEKERJAAN_PARTNER"}],
         [{"text": "🔙 Menu Utama", "callback_data": "MENU_KEMBALI"}]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "NAV_INFORMASI") {
     var textBaru = "📊 *PUSAT INFORMASI*\nSilakan pilih modul informasi yang ingin dilihat:";
     var keyboard = { inline_keyboard: [
         [{"text": "📩 Undangan", "callback_data": "NAV_INFO_UNDANGAN"}],
         [{"text": "🤝 Media Partner", "callback_data": "NAV_INFO_MEDPART"}],
         [{"text": "💰 Sponsorship", "callback_data": "NAV_INFO_SPONSOR"}],
         [{"text": "🔗 Partnership", "callback_data": "NAV_INFO_PARTNER"}],
         [{"text": "🔙 Menu Utama", "callback_data": "MENU_KEMBALI"}]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "NAV_ADMIN") {
     var textBaru = "🛠️ *PANEL ADMIN*\nSilakan pilih menu khusus Admin:";
     var keyboard = { inline_keyboard: [
         [{"text": "🗑️ Hapus Data", "callback_data": "MENU_ADMIN_HAPUS"}, {"text": "📢 Broadcast", "callback_data": "MENU_ADMIN_BROADCAST"}],
         [{"text": "🔙 Menu Utama", "callback_data": "MENU_KEMBALI"}]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
      return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
   }

   if (action === "MENU_ADMIN_BROADCAST") {
      var textBaru = "📢 *BROADCAST KE SELURUH STAFF PR*\n\nSilakan ketikkan pesan yang ingin kamu sebarkan. Semua anggota PR yang sudah mendaftar akan menerima pesan ini lewat DM.\n\n_(Ketik `/batal` jika ingin membatalkan)_";
      var keyboard = { inline_keyboard: [[{"text": "🔙 Batal", "callback_data": "NAV_ADMIN"}]] };
      UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
      
      var cache = CacheService.getScriptCache();
      cache.put("WIZ_STATE_" + userIdCallback, "WIZ_ADMIN_BROADCAST", 600);
      trackMsg(userIdCallback, messageId);
      return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
   }

  if (action === "MENU_ADMIN_HAPUS") {
     var textBaru = "🗑️ *HAPUS DATA (ADMIN)*\n\nSilakan pilih modul mana yang datanya ingin dihapus permanen:";
     var keyboard = { inline_keyboard: [
         [{"text": "📩 Undangan", "callback_data": "ADMIN_HAPUS|UNDANGAN"}, {"text": "🤝 Media Partner", "callback_data": "ADMIN_HAPUS|MEDPART"}],
         [{"text": "💰 Sponsorship", "callback_data": "ADMIN_HAPUS|SPONSOR"}, {"text": "🔗 Partnership", "callback_data": "ADMIN_HAPUS|PARTNER"}],
         [{"text": "🔙 Kembali", "callback_data": "NAV_ADMIN"}]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "ADMIN_HAPUS") {
     var modul = parts[1];
     var contoh = "U01, M05";
     if (modul === "SPONSOR" || modul === "PARTNER") contoh = "1, 2, 3 (Nomor Urut)";
     
     var textBaru = "🗑️ *HAPUS DATA " + modul + "*\n\nSilakan ketik *ID Data* yang ingin dihapus.\n_(Misalnya: " + contoh + ")_";
     var keyboard = { inline_keyboard: [[{"text": "🔙 Batal", "callback_data": "MENU_ADMIN_HAPUS"}]] };
     
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     
     var cache = CacheService.getScriptCache();
     cache.put("WIZ_STATE_" + userIdCallback, "WIZ_ADMIN_HAPUS|" + modul, 600);
     trackMsg(userIdCallback, messageId);
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }
  
  if (action === "CONFIRM_HAPUS") {
      var modul = parts[1];
      var idHapus = parts[2];
      
      var namaSheet = "";
      var headerRows = 0;
      var hasStringId = false;
      var prefix = "";
      
      if (modul === "UNDANGAN") { namaSheet = "Undangan"; headerRows = 2; hasStringId = true; prefix = "U"; }
      else if (modul === "MEDPART") { namaSheet = "Medpart"; headerRows = 2; hasStringId = true; prefix = "M"; }
      else if (modul === "SPONSOR") { namaSheet = "Sponsorship"; headerRows = 1; } 
      else if (modul === "PARTNER") { namaSheet = "Partnership"; headerRows = 1; }
      
      var sheet = SpreadsheetApp.openById(sheetId).getSheetByName(namaSheet);
      if (!sheet && modul === "MEDPART") sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
      
      if (!sheet) {
          UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: "❌ Sheet " + modul + " tidak ditemukan." }), muteHttpExceptions: true });
          return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
      }
      
      var dataAll = sheet.getDataRange().getValues();
      var barisDitemukan = -1;
      
      for (var i = headerRows; i < dataAll.length; i++) {
         if (hasStringId) {
             if (dataAll[i][1] === idHapus) { barisDitemukan = i + 1; break; }
         } else {
             if (String(dataAll[i][0]) === String(idHapus)) { barisDitemukan = i + 1; break; }
         }
      }
      
      if (barisDitemukan !== -1) {
         sheet.deleteRow(barisDitemukan);
         var lastRow = sheet.getLastRow();
         var numRows = lastRow - headerRows; 
         if (numRows > 0) {
            var newNumbers = [];
            var newIDs = [];
            for (var r = 1; r <= numRows; r++) {
               newNumbers.push([r]);
               if (hasStringId) newIDs.push([prefix + String(r).padStart(2, '0')]);
            }
            sheet.getRange(headerRows + 1, 1, numRows, 1).setValues(newNumbers);
            if (hasStringId) sheet.getRange(headerRows + 1, 2, numRows, 1).setValues(newIDs);
         }
         var textSukses = "✅ Data *" + modul + "* (" + idHapus + ") berhasil dihapus secara permanen dan penomoran (NO) telah dirapikan kembali. 💅";
         UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textSukses, parse_mode: "Markdown" }), muteHttpExceptions: true });
      } else {
         var textGagal = "❌ ID *" + idHapus + "* tidak ditemukan di database " + modul + ".";
         UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textGagal, parse_mode: "Markdown" }), muteHttpExceptions: true });
      }
      return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  // --- NAVIGASI LEVEL 2 (PEKERJAAN) ---
  if (action === "NAV_PEKERJAAN_UNDANGAN") {
     var textBaru = "📩 *MODUL UNDANGAN*\nSilakan pilih fitur yang ingin digunakan:";
     var keyboard = { inline_keyboard: [
         [{"text": "📝 Input Undangan Baru", "callback_data": "MENU_INPUT_UNDANGAN"}],
         [{"text": "👥 Ambil Delegasi", "callback_data": "MENU_DAFTAR_DELEGASI"}],
         [{"text": "📸 Unggah Bukti Kehadiran", "callback_data": "MENU_UPLOAD_FOTO_UNDANGAN"}],
         [{"text": "⚙️ Edit Undangan", "callback_data": "MENU_EDIT_UNDANGAN"}],
         [{"text": "🔙 Kembali", "callback_data": "NAV_PEKERJAAN"}]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "NAV_PEKERJAAN_MEDPART") {
     var textBaru = "🤝 *MODUL MEDIA PARTNER*\nSilakan pilih fitur yang ingin digunakan:";
     var keyboard = { inline_keyboard: [
         [{"text": "📝 Input Medpart Baru", "callback_data": "MENU_INPUT_MEDPART"}],
         [{"text": "⚙️ Update Mediapartner", "callback_data": "MENU_UPDATE_MEDPART_LIST"}],
         [{"text": "🔙 Kembali", "callback_data": "NAV_PEKERJAAN"}]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "NAV_PEKERJAAN_SPONSOR") {
     var textBaru = "💰 *MODUL SPONSORSHIP*\nSilakan pilih menu di bawah ini:";
     var keyboard = { inline_keyboard: [
         [{"text": "📝 Input SP Baru", "callback_data": "MENU_INPUT_SP"}],
         [{"text": "🔙 Kembali", "callback_data": "NAV_PEKERJAAN"}]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "NAV_PEKERJAAN_PARTNER") {
     var textBaru = "🔗 *MODUL PARTNERSHIP*\nSilakan pilih menu di bawah ini:";
     var keyboard = { inline_keyboard: [
         [{"text": "📝 Input Partner Baru", "callback_data": "MENU_INPUT_PT"}],
         [{"text": "🔙 Kembali", "callback_data": "NAV_PEKERJAAN"}]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  // --- NAVIGASI LEVEL 2 (INFORMASI) ---
  if (action === "NAV_INFO_UNDANGAN") {
     var textBaru = "📅 *INFO UNDANGAN*\nSilakan pilih informasi yang ingin kamu lihat:";
     var keyboard = { inline_keyboard: [
         [{"text": "📅 Mendatang", "callback_data": "ACTION_INFO|mendatang"}],
         [{"text": "📆 Rekap Bulanan", "callback_data": "MENU_CEK_JADWAL"}],
         [{"text": "🔙 Kembali", "callback_data": "NAV_INFORMASI"}]
     ] };
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "NAV_INFO_MEDPART") {
     clearWizardMessages(chatId, userIdCallback);
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/deleteMessage", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId }), muteHttpExceptions: true });
     handleInfoCommand(chatId, "/info medpart");
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "NAV_INFO_SPONSOR") {
     var textBaru = "💰 *INFO SPONSORSHIP*\n\nBelum ada rekap otomatis untuk modul ini. Cek spreadsheet untuk data detail.";
     var keyboard = { inline_keyboard: [[{"text": "🔙 Kembali", "callback_data": "NAV_INFORMASI"}]] };
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "NAV_INFO_PARTNER") {
     var textBaru = "🔗 *INFO PARTNERSHIP*\n\nBelum ada rekap otomatis untuk modul ini. Cek spreadsheet untuk data detail.";
     var keyboard = { inline_keyboard: [[{"text": "🔙 Kembali", "callback_data": "NAV_INFORMASI"}]] };
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_UPLOAD_FOTO_UNDANGAN") {
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
    var data = sheet.getDataRange().getValues();
    var buttons = [];
    var hariIni = new Date();
    hariIni.setHours(0,0,0,0);
    hariIni.setDate(hariIni.getDate() - 7);
    var tahunIni = hariIni.getFullYear();
    
    for(var i = Math.max(2, data.length - 40); i < data.length; i++) {
        var idSurat = data[i][1];
        var uk = data[i][3];
        var waktu = data[i][5];
        var foto = data[i][8] ? String(data[i][8]).trim() : "";
        if (idSurat && waktu && foto === "") {
            var tglAcara;
            if (waktu instanceof Date) tglAcara = new Date(waktu);
            else {
               var parts = String(waktu).trim().split(" ")[0].split(/[-/]/);
               if(parts.length >= 2) tglAcara = new Date(tahunIni, parseInt(parts[1])-1, parseInt(parts[0]));
            }
            if (tglAcara) {
                tglAcara.setHours(0,0,0,0);
                if (tglAcara.getTime() >= hariIni.getTime()) {
                    buttons.push([{"text": "📸 " + idSurat + " - " + uk, "callback_data": "UPLOAD_FOTO_PILIH|" + idSurat}]);
                }
            }
        }
    }
    
    var textBaru = "📸 *UNGGAH BUKTI KEHADIRAN*\n\nSilakan pilih undangan yang fotonya ingin kamu unggah:";
    if (buttons.length === 0) textBaru = "✨ Wah, semua undangan terbaru sudah memiliki foto bukti kehadiran atau tidak ada jadwal terdekat!";
    
    buttons.push([{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_UNDANGAN"}]);
    var keyboard = { "inline_keyboard": buttons };
    
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "UPLOAD_FOTO_PILIH") {
     var idSurat = parts[1];
     var textBaru = "📸 *Unggah Foto untuk " + idSurat + "*\n\nSilakan kirimkan *1 foto* (berupa gambar, bukan dokumen file) di chat ini sekarang juga.";
     var keyboard = { "inline_keyboard": [[{"text": "🔙 Batal", "callback_data": "MENU_UPLOAD_FOTO_UNDANGAN"}]] };
     
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     
     var cache = CacheService.getScriptCache();
     cache.put("WIZ_STATE_" + userIdCallback, "WIZ_FOTO_UND|" + idSurat, 600);
     trackMsg(userIdCallback, messageId);
     
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_EDIT_UNDANGAN") {
    var textBaru = "⚙️ *EDIT DATA UNDANGAN*\n\nSilakan ketik *ID Surat / Undangan* yang datanya ingin diubah.\n_(Misalnya: U01, U12, U45)_";
    var keyboard = { "inline_keyboard": [[{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_UNDANGAN"}]] };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    
    var cache = CacheService.getScriptCache();
    cache.put("WIZ_STATE_" + userIdCallback, "WIZ_EDIT_UND_ID", 600);
    trackMsg(userIdCallback, messageId);
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "EDIT_UND_PILIH") {
     var idSurat = parts[1];
     var textBaru = "⚙️ *Edit Undangan " + idSurat + "*\n\nData apa yang ingin kamu ubah?";
     var keyboard = { inline_keyboard: [
         [{ text: "🏢 Pengirim", callback_data: "EDIT_UND_SET|PENGIRIM|" + idSurat }],
         [{ text: "📝 Kegiatan", callback_data: "EDIT_UND_SET|KEGIATAN|" + idSurat }],
         [{ text: "🗓️ Tanggal & Waktu", callback_data: "EDIT_UND_SET|WAKTU|" + idSurat }],
         [{ text: "📍 Lokasi", callback_data: "EDIT_UND_SET|LOKASI|" + idSurat }],
         [{ text: "🔙 Batal", callback_data: "MENU_EDIT_UNDANGAN" }]
     ]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "EDIT_UND_SET") {
     var field = parts[1];
     var idSurat = parts[2];
     var textBaru = "";
     var state = "";
     if (field === "PENGIRIM") {
        textBaru = "🏢 Silakan ketik nama *Pengirim* baru untuk " + idSurat + ".";
        state = "WIZ_EDIT_UND|PENGIRIM|" + idSurat;
     } else if (field === "KEGIATAN") {
        textBaru = "📝 Silakan ketik *Nama Kegiatan* baru untuk " + idSurat + ".";
        state = "WIZ_EDIT_UND|KEGIATAN|" + idSurat;
     } else if (field === "WAKTU") {
        textBaru = "🗓️ Mau diubah ke *Tanggal & Waktu* berapa?\n_(misal: 02/11 08:00)_";
        state = "WIZ_EDIT_UND|WAKTU|" + idSurat;
     } else if (field === "LOKASI") {
        textBaru = "📍 Silakan ketik *Lokasi* baru untuk " + idSurat + ".";
        state = "WIZ_EDIT_UND|LOKASI|" + idSurat;
     }
     var keyboard = { inline_keyboard: [[{ text: "🔙 Batal", callback_data: "EDIT_UND_PILIH|" + idSurat }]]};
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
     var cache = CacheService.getScriptCache();
     cache.put("WIZ_STATE_" + userIdCallback, state, 600);
     trackMsg(userIdCallback, messageId);
     return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  if (action === "MENU_UPDATE_MEDPART_LIST") {
    var textBaru = "⚙️ *UPDATE MEDIA PARTNER*\n\nSilakan ketik *ID Media Partner* yang datanya ingin dilengkapi/diedit.\n_(Misalnya: M01, M05, M12)_";
    var keyboard = { "inline_keyboard": [[{"text": "🔙 Batal", "callback_data": "NAV_PEKERJAAN_MEDPART"}]] };
    UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify({ chat_id: String(chatId), message_id: messageId, text: textBaru, parse_mode: "Markdown", reply_markup: keyboard }), muteHttpExceptions: true });
    
    var cache = CacheService.getScriptCache();
    cache.put("WIZ_STATE_" + userIdCallback, "WIZ_EDIT_MP_ID", 600);
    trackMsg(userIdCallback, messageId);
    return UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  }

  // Matikan efek loading di tombol Telegram untuk action lain
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery?callback_query_id=" + callbackQuery.id);
  
   if (action === "DL") {
      var idSuratDicari = parts[1];
      var namaBaku = parts[2];
      prosesDelegasiSheet(chatId, idSuratDicari, namaBaku);
      var payloadEdit = { chat_id: String(chatId), message_id: messageId, text: "✅ Pilihan nama *" + namaBaku + "* sedang diproses oleh Monalissa... 💅", parse_mode: "Markdown" };
      UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
   } else if (action === "DF") {
      var userId = parts[1];
      var namaBaku = parts[2];
      prosesDaftarUser(chatId, userId, namaBaku);
      var payloadEdit = { chat_id: String(chatId), message_id: messageId, text: "✅ Pendaftaran untuk *" + namaBaku + "* sedang diproses oleh Monalissa... 💅", parse_mode: "Markdown" };
      UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/editMessageText", { method: "post", contentType: "application/json", payload: JSON.stringify(payloadEdit) });
   }
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
        kirimBalasanGanda(chatId, "✅ *DELEGASI DICATAT!*\n\n*ID:* " + idSuratDicari + "\n*Delegasi:* " + namaBaku);
     } else {
        if (delegasiSekarang.indexOf(namaBaku) !== -1) {
           sendMessage(chatId, "⚠️ *" + namaBaku + "*, kamu sudah terdaftar di undangan ini!");
        } else {
           var delegasiBaru = delegasiSekarang + ", " + namaBaku;
           selDelegasi.setValue(delegasiBaru);
           updateRekapDelegasi(namaBaku); 
           kirimBalasanGanda(chatId, "✅ *DELEGASI TAMBAHAN DICATAT!*\n\n*ID:* " + idSuratDicari + "\n*Delegasi Lengkap:*\n" + delegasiBaru);
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
               "9. Cek Status Medpart: /info medpart\n" +
               "10. Cek Status Undangan: /info (jadwal mendatang), /info semua (seluruh data), atau /info bulan [nama_bulan]\n\n" +
               "ATURAN SUPER KETAT UNTUK INPUT UNDANGAN BARU (/i):\n" +
               "- Kamu HARUS mengekstrak 5 data wajib: (Pengirim, Nama Kegiatan, Tanggal, Jam, Lokasi).\n" +
               "- JIKA ada data yang kurang/tidak disebutkan di pesan asli, JANGAN berikan format /i! Balas dengan: ERROR: Pesan kamu kurang lengkap nih! Tolong sebutkan [sebutkan bagian yang kurang, misal: lokasi acaranya di mana dan jam berapa?] agar Monalissa bisa mencatatnya ke buku tamu 💅\n" +
               "- JANGAN PERNAH meminta informasi Tahun! Sistem ini dirancang untuk kepengurusan tahun berjalan (2026/sekarang). Jika pesan tidak menyebutkan tahun, abaikan saja. JIKA pesan menyebutkan tanggal tanpa bulan (misal 'tanggal 6'), baru kamu boleh menanyakan bulannya.\n" +
               "- Kamu sangat cerdas, konversi teks waktu apa pun (misal '25 oktober', 'besok', 'jam setengah 3 sore') menjadi format Tanggal DD/MM (misal 25/10) dan Jam HH:MM (misal 14:30).\n" +
               "- Pastikan 'Nama Pengirim' ditulis HURUF BESAR SEMUA (contoh: UKKPK, BEM).\n" +
               "- Pastikan 'Nama Kegiatan' dan 'Lokasi' menggunakan Huruf Kapital di Awal Kata (Title Case). NAMUN untuk singkatan nama gedung/kampus (seperti MKU, PKM, LP2M, GOR, FIP, FEB, UNP) TETAPKAN SEBAGAI HURUF BESAR. Dan jika ada kata 'lantai', persingkat menjadi 'Lt.' agar rapi.\n\n" +
               "ATURAN UMUM:\n" +
               "- Output HARUS HANYA format baku yang diawali dengan slash (/) jika pesan lengkap.\n" +
               "- JIKA pesan meminta untuk mengecek jadwal undangan, gunakan format: /info (jika umum), /info semua (jika meminta semua waktu), atau /info bulan nama_bulan (jika meminta bulan spesifik).\n" +
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
// ==========================================
// 🍀 INTERACTIVE WIZARD & CUSTOM KEYBOARD (MENU CLOVER)
// ==========================================

/**
 * Mengirim pesan dengan ReplyKeyboardMarkup (tombol menu permanen / logo Clover 🍀).
 * Keyboard ini akan tersimpan permanen di pojok kanan input chat Telegram
 * setelah user menekan /start untuk pertama kalinya.
 */
function trackMsg(userId, msgId) {
  if(!msgId) return;
  var cache = CacheService.getScriptCache();
  var key = "WIZ_MSGS_" + userId;
  var existing = cache.get(key) || "";
  cache.put(key, existing ? existing + "," + msgId : String(msgId), 600);
}

function clearWizardMessages(chatId, userId, excludeMsgId) {
  var cache = CacheService.getScriptCache();
  var key = "WIZ_MSGS_" + userId;
  var msgList = cache.get(key);
  if (msgList) {
     var ids = msgList.split(",");
     for(var i=0; i<ids.length; i++) {
        if (excludeMsgId && String(ids[i]) === String(excludeMsgId)) continue;
        var url = "https://api.telegram.org/bot" + token + "/deleteMessage";
        var payload = { chat_id: String(chatId), message_id: ids[i] };
        UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true });
     }
     cache.remove(key);
  }
}

function kirimMenuUtama(chatId, customText, isAdmin) {
  var cache = CacheService.getScriptCache();
  
  if (isAdmin === undefined) {
      isAdmin = cekMemberGrup(chatId).isAdmin;
  }
  
  // Hapus menu lama jika ada (agar tidak melompat-lompat / menumpuk)
  var lastMenuId = cache.get("LAST_MENU_" + chatId);
  if (lastMenuId) {
     UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/deleteMessage", {
         method: "post", contentType: "application/json", 
         payload: JSON.stringify({ chat_id: String(chatId), message_id: lastMenuId }), 
         muteHttpExceptions: true
     });
     cache.remove("LAST_MENU_" + chatId);
  }

  var inlineKbd = [
    [{"text": "🏢 Pekerjaan", "callback_data": "NAV_PEKERJAAN"}, {"text": "📊 Informasi", "callback_data": "NAV_INFORMASI"}]
  ];
  
  if (isAdmin) {
      inlineKbd.push([{"text": "🛠️ Admin", "callback_data": "NAV_ADMIN"}]);
  }

  var keyboard = {
    "inline_keyboard": inlineKbd
  };
  var botMsgId = sendMessage(chatId, customText || "Selamat datang di *Menu Interaktif Monalissa*! 💅\nSilakan pilih menu di bawah ini:", keyboard);
  if (botMsgId) cache.put("LAST_MENU_" + chatId, String(botMsgId), 21600);
}

function processWizardInput(chatId, userId, text, userMessageId, msg) {
  var cache = CacheService.getScriptCache();
  var userState = cache.get("WIZ_STATE_" + userId);

  // ---- INTERCEPT CLOVER MENU SAAT SEDANG WIZARD ----
  var isMenuButton = text && (text === "🏢 Pekerjaan" || text === "📊 Informasi" || text === "🛠️ Admin");
  if (text && (text.toLowerCase() === "/batal" || isMenuButton)) {
    if (userState !== null) {
      cache.remove("WIZ_STATE_" + userId);
      cache.remove("WIZ_PENGIRIM_" + userId);
      cache.remove("WIZ_KEGIATAN_" + userId);
      cache.remove("WIZ_TGLBLN_" + userId);
      cache.remove("WIZ_JAM_" + userId);
      
      // Cleanup cache SP
      cache.remove("WIZ_SP_INSTANSI_" + userId);
      cache.remove("WIZ_SP_TGL_" + userId);
      cache.remove("WIZ_SP_SYARAT_" + userId);
      
      // Cleanup cache PT
      cache.remove("WIZ_PT_INSTANSI_" + userId);
      cache.remove("WIZ_PT_SYARAT_" + userId);
      cache.remove("WIZ_PT_BENEFIT_" + userId);
      cache.remove("WIZ_PT_MULAI_" + userId);
      
      trackMsg(userId, userMessageId);
      clearWizardMessages(chatId, userId);
      
      if (!isMenuButton) kirimMenuUtama(chatId, "❌ Proses input dibatalkan.");
    }
    if (isMenuButton) return false; // Lanjut ke Clover Handler di bawah
    return true;
  }
  
  if (userState === null) return false; // Bukan urusan wizard
  
  // Track user's answer message ID
  trackMsg(userId, userMessageId);

  // =====================
  // TAHAP INPUT UNDANGAN
  // =====================
  if (userState === "ISI_PENGIRIM") {
    cache.put("WIZ_PENGIRIM_" + userId, text, 600);
    var botMsgId = sendMessage(chatId, "✅ Pengirim: *" + text + "*\n\nSekarang, apa *Nama Kegiatan* acaranya?");
    trackMsg(userId, botMsgId);
    cache.put("WIZ_STATE_" + userId, "ISI_KEGIATAN", 600);
    return true;
  }
  
  if (userState === "ISI_KEGIATAN") {
    cache.put("WIZ_KEGIATAN_" + userId, text, 600);
    var botMsgId = sendMessage(chatId, "✅ Kegiatan: *" + text + "*\n\nKapan *Tanggal dan Bulan* acaranya?\n_(Contoh: 25/10 atau 25-10)_");
    trackMsg(userId, botMsgId);
    cache.put("WIZ_STATE_" + userId, "ISI_TGLBLN", 600);
    return true;
  }
  
  if (userState === "ISI_TGLBLN") {
    cache.put("WIZ_TGLBLN_" + userId, text, 600);
    var botMsgId = sendMessage(chatId, "✅ Tanggal: *" + text + "*\n\nJam berapa acaranya dimulai?\n_(Contoh: 09:00 atau 14 30)_");
    trackMsg(userId, botMsgId);
    cache.put("WIZ_STATE_" + userId, "ISI_JAM", 600);
    return true;
  }
  
  if (userState === "ISI_JAM") {
    cache.put("WIZ_JAM_" + userId, text, 600);
    var botMsgId = sendMessage(chatId, "✅ Jam: *" + text + "*\n\nTerakhir nih, di mana *Lokasi* acaranya?");
    trackMsg(userId, botMsgId);
    cache.put("WIZ_STATE_" + userId, "ISI_LOKASI", 600);
    return true;
  }
  
  if (userState === "ISI_LOKASI") {
    var pengirim = cache.get("WIZ_PENGIRIM_" + userId) || "";
    var kegiatan = cache.get("WIZ_KEGIATAN_" + userId) || "";
    var tglBln = cache.get("WIZ_TGLBLN_" + userId) || "";
    var jamMenit = cache.get("WIZ_JAM_" + userId) || "";
    var lokasi = text;
    
    cache.remove("WIZ_STATE_" + userId);
    
    pengirim = pengirim.toUpperCase();
    kegiatan = smartTitleCase(kegiatan);
    lokasi = smartTitleCase(lokasi);
    
    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
    var dataID = sheet.getRange("B3:B" + sheet.getLastRow()).getValues();
    var maxID = 0;
    for (var i = 0; i < dataID.length; i++) {
      var idSekarang = dataID[i][0].toString().replace("U", "");
      var angkaID = parseInt(idSekarang);
      if (!isNaN(angkaID) && angkaID > maxID) maxID = angkaID;
    }
    var idSurat = "U" + String(maxID + 1).padStart(2, '0');
    var now = new Date();
    var waktuDiterima = Utilities.formatDate(now, "Asia/Jakarta", "dd/MM HH:mm") + " WIB";
    
    var tglBlnRaw = tglBln.split(/[-/]/);
    var tgl = tglBlnRaw[0] ? String(tglBlnRaw[0]).trim().padStart(2, '0') : "01";
    var bln = tglBlnRaw[1] ? String(tglBlnRaw[1]).trim().padStart(2, '0') : "01";
    var jamMenitRaw = jamMenit.replace(/[^0-9]/g, " ").trim().split(/\s+/);
    var jam = jamMenitRaw[0] ? String(jamMenitRaw[0]).padStart(2, '0') : "00";
    var menit = jamMenitRaw[1] ? String(jamMenitRaw[1]).padStart(2, '0') : "00";
    var waktuSheet = tgl + "/" + bln + " " + jam + ":" + menit + " WIB";
    
    var thn = now.getFullYear();
    var tglObj = new Date(thn, parseInt(bln) - 1, parseInt(tgl));
    var namaHari = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][tglObj.getDay()];
    var namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][tglObj.getMonth()];
    var waktuTampil = namaHari + " (" + jam + ":" + menit + " WIB) " + tgl + " " + namaBulan;
    
    var barisTujuan = sheet.getLastRow() + 1;
    sheet.appendRow([barisTujuan - 2, idSurat, waktuDiterima, pengirim, kegiatan, waktuSheet, lokasi, "", ""]);
    
    clearWizardMessages(chatId, userId);

    var balasan = "🚨 *UNDANGAN BARU MASUK!* 🚨\n_(via Menu Interaktif 🍀)_\n\n*ID Surat:* " + idSurat + "\n*UK Pengirim:* " + pengirim + "\n*Kegiatan:* " + kegiatan + "\n*Waktu:* " + waktuTampil + "\n*Lokasi:* " + lokasi + "\n\n👥 _Siapa yang bersedia? Silakan daftarkan diri lewat *Menu Pekerjaan -> Ambil Delegasi* di Personal Chat (DM) Monalissa._";
    kirimMenuUtama(chatId, balasan);
    
    if (grupChatId && String(chatId) !== String(grupChatId)) {
      sendMessage(grupChatId, balasan);
    }
    return true;
  }

  // =====================
  // TAHAP INPUT MEDPART
  // =====================
  if (userState === "MEDPART_INSTANSI") {
     cache.put("WIZ_MP_INSTANSI_" + userId, text, 600);
     var botMsgId = sendMessage(chatId, "✅ Instansi: *" + text + "*\n\nKapan *Tanggal Upload* poster yang diinginkan?");
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "MEDPART_TGL", 600);
     return true;
  }
  
  if (userState === "MEDPART_TGL") {
     cache.put("WIZ_MP_TGL_" + userId, text, 600);
     var botMsgId = sendMessage(chatId, "✅ Tanggal: *" + text + "*\n\nTerakhir, kirimkan *Link GDrive* atau *Bukti Foto* bahwa syarat Medpart sudah terpenuhi!", 
         { inline_keyboard: [[{ text: "⏩ Lewati (Data Belum Ada)", callback_data: "WIZ_SKIP_INPUT" }]] }
     );
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "MEDPART_BUKTI", 600);
     return true;
  }
  
  if (userState === "MEDPART_BUKTI") {
     var fileLink = text;
     if (msg && msg.document) {
         var fileId = msg.document.file_id;
         sendMessage(chatId, "⏳ Mengunggah Dokumen Bukti ke GDrive (Folder: Medpart)...");
         var urlDrive = simpanFileKeDrive(fileId, "Medpart");
         if (urlDrive) fileLink = urlDrive;
     } else if (msg && msg.photo && msg.photo.length > 0) {
         var fileId = msg.photo[msg.photo.length - 1].file_id;
         sendMessage(chatId, "⏳ Mengunggah Foto Bukti ke GDrive (Folder: Medpart)...");
         var urlDrive = simpanFileKeDrive(fileId, "Medpart");
         if (urlDrive) fileLink = urlDrive;
     }

     var instansi = cache.get("WIZ_MP_INSTANSI_" + userId) || "";
     var tglUpload = cache.get("WIZ_MP_TGL_" + userId) || "";
     var bukti = fileLink;
     
     cache.remove("WIZ_STATE_" + userId);
     
     var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart");
     if(!sheet) sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
     
     var maxID = 0;
     if(sheet) {
        var dataID = sheet.getRange("B2:B" + sheet.getLastRow()).getValues();
        for (var i = 0; i < dataID.length; i++) {
          var idSekarang = dataID[i][0].toString().replace("M", "");
          var angkaID = parseInt(idSekarang);
          if (!isNaN(angkaID) && angkaID > maxID) maxID = angkaID;
        }
     }
     var idSurat = "M" + String(maxID + 1).padStart(2, '0');
     var now = new Date();
     var waktuDiterima = Utilities.formatDate(now, "Asia/Jakarta", "dd/MM HH:mm") + " WIB";
     
     if(sheet) {
        var barisTujuan = sheet.getLastRow() + 1;
        sheet.appendRow([barisTujuan - 2, idSurat, waktuDiterima, instansi, bukti, tglUpload, "", ""]);
     }
     
     clearWizardMessages(chatId, userId);
     
     var balasan = "🤝 *MEDPART BARU TERCATAT!* 🤝\n_(via Menu Interaktif 🍀)_\n\n*ID:* " + idSurat + "\n*Instansi:* " + instansi + "\n*Tanggal Upload:* " + tglUpload + "\n*Bukti/Link:* " + bukti;
     kirimMenuUtama(chatId, balasan);
     if (grupChatId && String(chatId) !== String(grupChatId)) {
       sendMessage(grupChatId, balasan);
     }
     return true;
  }

      return true;
  }

  // =====================
  // TAHAP INPUT SPONSORSHIP
  // =====================
  if (userState === "SP_INSTANSI") {
     cache.put("WIZ_SP_INSTANSI_" + userId, text, 600);
     var botMsgId = sendMessage(chatId, "✅ Instansi: *" + text + "*\n\nKapan *Tanggal/Waktu* pelaksanaannya?\n_(Ketik 'TBA' jika belum pasti)_");
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "SP_TGL", 600);
     return true;
  }

  if (userState === "SP_TGL") {
     cache.put("WIZ_SP_TGL_" + userId, text, 600);
     var botMsgId = sendMessage(chatId, "✅ Tanggal: *" + text + "*\n\nApa saja *Persyaratan* dari sponsor tersebut?\n_(Gunakan baris baru (Enter) untuk memisah antar poin)_");
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "SP_SYARAT", 600);
     return true;
  }

  if (userState === "SP_SYARAT") {
     var formattedSyarat = formatBulletPoints(text);
     cache.put("WIZ_SP_SYARAT_" + userId, formattedSyarat, 600);
     var botMsgId = sendMessage(chatId, "✅ Persyaratan:\n" + formattedSyarat + "\n\nTerakhir, apa saja *Benefit* yang kita dapatkan?\n_(Gunakan baris baru (Enter) untuk memisah antar poin)_");
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "SP_BENEFIT", 600);
     return true;
  }

  if (userState === "SP_BENEFIT") {
     var formattedBenefit = formatBulletPoints(text);
     cache.put("WIZ_SP_BENEFIT_" + userId, formattedBenefit, 600);
     var botMsgId = sendMessage(chatId, "✅ Benefit:\n" + formattedBenefit + "\n\nTerakhir, kirimkan **Dokumen MoU**.\n_(Harap kirim dalam bentuk File PDF/Word)_", 
         { inline_keyboard: [[{ text: "⏩ Lewati (MoU Belum Ada)", callback_data: "WIZ_SKIP_INPUT" }]] }
     );
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "SP_MOU", 600);
     return true;
  }

  if (userState === "SP_MOU") {
     if (msg && msg.photo && msg.photo.length > 0) {
         sendMessage(chatId, "❌ Maaf, untuk MoU harap kirimkan dalam bentuk **File Dokumen (PDF/Word)**, bukan Gambar/Foto biasa.\n\nSilakan konversi dulu ke PDF dan kirimkan ulang file-nya di sini!");
         return true; // Jangan hapus state, tunggu dia kirim ulang
     }

     var fileLink = text;
     if (msg && msg.document) {
         var fileId = msg.document.file_id;
         sendMessage(chatId, "⏳ Mengunggah Dokumen MoU ke GDrive (Folder: Sponsorship)...");
         var urlDrive = simpanFileKeDrive(fileId, "Sponsorship");
         if (urlDrive) fileLink = urlDrive;
     }

     var instansi = cache.get("WIZ_SP_INSTANSI_" + userId) || "";
     var tgl = cache.get("WIZ_SP_TGL_" + userId) || "";
     var syarat = cache.get("WIZ_SP_SYARAT_" + userId) || "";
     var benefit = cache.get("WIZ_SP_BENEFIT_" + userId) || "";
     var mou = fileLink;

     cache.remove("WIZ_STATE_" + userId);
     
     var sheetSp = SpreadsheetApp.openById(sheetId).getSheetByName("Sponsorship") || SpreadsheetApp.openById(sheetId).getSheetByName("Sponsor");
     if (!sheetSp) {
        kirimMenuUtama(chatId, "❌ Gagal: Tab 'Sponsorship' atau 'Sponsor' tidak ditemukan.");
        return true;
     }
     
     var barisTujuan = sheetSp.getLastRow() + 1;
     var nomorUrut = barisTujuan > 2 ? barisTujuan - 2 : 1; 
     sheetSp.appendRow([nomorUrut, smartTitleCase(instansi), tgl, syarat, benefit, mou]);
     
     clearWizardMessages(chatId, userId);
     
     var balasan = "💰 *SPONSORSHIP BARU TERCATAT!* 💰\n\n*Instansi:* " + smartTitleCase(instansi) + "\n*Tanggal:* " + tgl + "\n*Syarat:* \n" + syarat + "\n*Benefit:* \n" + benefit + "\n*MoU:* " + (mou || "TBA");
     kirimMenuUtama(chatId, balasan);
     if (grupChatId && String(chatId) !== String(grupChatId)) {
       sendMessage(grupChatId, balasan);
     }
     return true;
  }

  // =====================
  // TAHAP INPUT PARTNERSHIP
  // =====================
  if (userState === "PT_INSTANSI") {
     cache.put("WIZ_PT_INSTANSI_" + userId, text, 600);
     var botMsgId = sendMessage(chatId, "✅ Instansi: *" + text + "*\n\nApa saja **Point of Agreement (PoA) UKBA**?\n_(Kewajiban pihak PR UKBA, gunakan Enter untuk memisah poin)_");
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "PT_SYARAT", 600);
     return true;
  }

  if (userState === "PT_SYARAT") {
     var formattedPoaUkba = formatBulletPoints(text);
     cache.put("WIZ_PT_SYARAT_" + userId, formattedPoaUkba, 600);
     var botMsgId = sendMessage(chatId, "✅ PoA UKBA:\n" + formattedPoaUkba + "\n\nApa saja **Point of Agreement (PoA) EKSTERNAL**?\n_(Kewajiban pihak Partner, gunakan Enter untuk memisah poin)_");
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "PT_BENEFIT", 600);
     return true;
  }

  if (userState === "PT_BENEFIT") {
     var formattedPoaEks = formatBulletPoints(text);
     cache.put("WIZ_PT_BENEFIT_" + userId, formattedPoaEks, 600);
     var botMsgId = sendMessage(chatId, "✅ PoA Eksternal:\n" + formattedPoaEks + "\n\nKapan *Tanggal Mulai* kerjasama ini?\n_(Misal: 10 Oktober 2026)_");
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "PT_MULAI", 600);
     return true;
  }

  if (userState === "PT_MULAI") {
     cache.put("WIZ_PT_MULAI_" + userId, text, 600);
     var botMsgId = sendMessage(chatId, "✅ Tanggal Mulai: *" + text + "*\n\nDan kapan *Tanggal Selesai* kerjasama ini?");
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "PT_SELESAI", 600);
     return true;
  }

  if (userState === "PT_SELESAI") {
     cache.put("WIZ_PT_SELESAI_" + userId, text, 600);
     var botMsgId = sendMessage(chatId, "✅ Tanggal Selesai: *" + text + "*\n\nTerakhir, kirimkan **Dokumen MoU**.\n_(Harap kirim dalam bentuk File PDF/Word)_", 
         { inline_keyboard: [[{ text: "⏩ Lewati (MoU Belum Ada)", callback_data: "WIZ_SKIP_INPUT" }]] }
     );
     trackMsg(userId, botMsgId);
     cache.put("WIZ_STATE_" + userId, "PT_MOU", 600);
     return true;
  }

  if (userState === "PT_MOU") {
     if (msg && msg.photo && msg.photo.length > 0) {
         sendMessage(chatId, "❌ Maaf, untuk MoU harap kirimkan dalam bentuk **File Dokumen (PDF/Word)**, bukan Gambar/Foto biasa.\n\nSilakan konversi dulu ke PDF dan kirimkan ulang file-nya di sini!");
         return true; // Jangan hapus state, tunggu dia kirim ulang
     }

     var fileLink = text;
     if (msg && msg.document) {
         var fileId = msg.document.file_id;
         sendMessage(chatId, "⏳ Mengunggah Dokumen MoU ke GDrive (Folder: Partnership)...");
         var urlDrive = simpanFileKeDrive(fileId, "Partnership");
         if (urlDrive) fileLink = urlDrive;
     }

     var instansi = cache.get("WIZ_PT_INSTANSI_" + userId) || "";
     var syarat = cache.get("WIZ_PT_SYARAT_" + userId) || "";
     var benefit = cache.get("WIZ_PT_BENEFIT_" + userId) || "";
     var mulai = cache.get("WIZ_PT_MULAI_" + userId) || "";
     var selesai = cache.get("WIZ_PT_SELESAI_" + userId) || "";
     var mou = fileLink;

     cache.remove("WIZ_STATE_" + userId);
     
     var sheetPt = SpreadsheetApp.openById(sheetId).getSheetByName("Partnership") || SpreadsheetApp.openById(sheetId).getSheetByName("Partner");
     if (!sheetPt) {
        kirimMenuUtama(chatId, "❌ Gagal: Tab 'Partnership' tidak ditemukan.");
        return true;
     }
     
     var barisTujuan = sheetPt.getLastRow() + 1;
     var nomorUrut = barisTujuan > 2 ? barisTujuan - 2 : 1;
     sheetPt.appendRow([nomorUrut, smartTitleCase(instansi), syarat, benefit, mulai, selesai, mou]);
     
     clearWizardMessages(chatId, userId);
     
     var balasan = "🔗 *PARTNERSHIP BARU TERCATAT!* 🔗\n\n*Instansi:* " + smartTitleCase(instansi) + "\n*Periode:* " + mulai + " - " + selesai + "\n*PoA UKBA:* \n" + syarat + "\n*PoA Eksternal:* \n" + benefit + "\n*MoU:* " + (mou || "TBA");
     kirimMenuUtama(chatId, balasan);
     if (grupChatId && String(chatId) !== String(grupChatId)) {
       sendMessage(grupChatId, balasan);
     }
     return true;
  }

  // =====================
  // TAHAP DAFTAR DELEGASI
  // =====================
  if (userState === "DELEGASI_NAMA") {
      var idDelegasi = cache.get("WIZ_DELEGASI_ID_" + userId) || "";
      cache.remove("WIZ_STATE_" + userId);
      
      clearWizardMessages(chatId, userId);
      
      var validasiNama = cariNamaLengkapDatabase(text);
      if (!validasiNama.status) {
         kirimMenuUtama(chatId, validasiNama.msg);
         return true;
      }
      
      prosesDelegasiSheet(chatId, idDelegasi, validasiNama.nama);
      kirimMenuUtama(chatId, "✅ Pendaftaran " + validasiNama.nama + " di " + idDelegasi + " telah diproses Monalissa! 💅");
      return true;
  }

  if (userState.startsWith("EDIT_MP_")) {
     var parts = userState.split("|");
     var type = parts[0];
     var idMp = parts[1];
     
     cache.remove("WIZ_STATE_" + userId);
     trackMsg(userId, userMessageId);
     
     var sheetMp = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart") || SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
     var dataAll = sheetMp.getDataRange().getValues();
     var baris = -1;
     for (var i = 0; i < dataAll.length; i++) {
         if (dataAll[i][1] === idMp) { baris = i + 1; break; }
     }
     
     if (baris !== -1) {
         if (type === "EDIT_MP_SYARAT") {
             sheetMp.getRange(baris, 7).setValue(text);
             clearWizardMessages(chatId, userId);
             kirimMenuUtama(chatId, "✅ Syarat untuk *" + idMp + "* berhasil diupdate!");
         } else if (type === "EDIT_MP_TGL") {
             sheetMp.getRange(baris, 6).setValue(text);
             clearWizardMessages(chatId, userId);
             kirimMenuUtama(chatId, "✅ Tanggal upload untuk *" + idMp + "* berhasil diubah menjadi: " + text);
         } else if (type === "EDIT_MP_POSTER") {
             if (!msg || !msg.photo) {
                var errId = sendMessage(chatId, "❌ Itu bukan foto! Silakan ulangi dengan mengirimkan foto gambar.");
                trackMsg(userId, errId);
                return true;
             }
             var fileIdTelegram = msg.photo[msg.photo.length - 1].file_id;
             var directImageUrl = simpanFileKeDrive(fileIdTelegram, "Medpart");
             
             if (!directImageUrl) {
                 var errId = sendMessage(chatId, "❌ Gagal menyimpan poster ke Google Drive.");
                 trackMsg(userId, errId);
                 return true;
             }
             
             sheetMp.getRange(baris, 8).setFormula('=IMAGE("' + directImageUrl + '")');
             clearWizardMessages(chatId, userId);
             kirimMenuUtama(chatId, "📸 *Poster Final Berhasil Disimpan!*\n\nPoster untuk " + idMp + " sudah diamankan oleh Monalissa. 💅");
         }
     } else {
         clearWizardMessages(chatId, userId);
         kirimMenuUtama(chatId, "❌ Gagal: ID Medpart *" + idMp + "* tidak ditemukan!");
     }
     return true;
  }

  if (userState.startsWith("WIZ_EDIT_UND|")) {
     var parts = userState.split("|");
     var field = parts[1];
     var idSurat = parts[2];
     
     cache.remove("WIZ_STATE_" + userId);
     trackMsg(userId, userMessageId);
     
     var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
     var dataAll = sheet.getDataRange().getValues();
     var baris = -1;
     for (var i = 0; i < dataAll.length; i++) {
         if (dataAll[i][1] === idSurat) { baris = i + 1; break; }
     }
     
     if (baris !== -1) {
         if (field === "PENGIRIM") {
             sheet.getRange(baris, 4).setValue(text.toUpperCase());
             clearWizardMessages(chatId, userId);
             kirimMenuUtama(chatId, "✅ Pengirim untuk *" + idSurat + "* berhasil diubah menjadi: *" + text.toUpperCase() + "*");
         } else if (field === "KEGIATAN") {
             sheet.getRange(baris, 5).setValue(smartTitleCase(text));
             clearWizardMessages(chatId, userId);
             kirimMenuUtama(chatId, "✅ Kegiatan untuk *" + idSurat + "* berhasil diubah menjadi: *" + smartTitleCase(text) + "*");
         } else if (field === "WAKTU") {
             var val = text;
             if(val.toLowerCase().indexOf("wib") === -1) val += " WIB";
             sheet.getRange(baris, 6).setValue(val);
             clearWizardMessages(chatId, userId);
             kirimMenuUtama(chatId, "✅ Waktu untuk *" + idSurat + "* berhasil diubah menjadi: *" + val + "*");
         } else if (field === "LOKASI") {
             sheet.getRange(baris, 7).setValue(smartTitleCase(text));
             clearWizardMessages(chatId, userId);
             kirimMenuUtama(chatId, "✅ Lokasi untuk *" + idSurat + "* berhasil diubah menjadi: *" + smartTitleCase(text) + "*");
         }
     } else {
         kirimMenuUtama(chatId, "❌ Gagal: Data " + idSurat + " tidak ditemukan!");
     }
     return true;
  }

  if (userState === "WIZ_EDIT_MP_ID") {
     var idMpRaw = text.trim().toUpperCase();
     var idMp = idMpRaw;
     if (!idMp.startsWith("M")) idMp = "M" + idMp.padStart(2, '0');
     
     var sheetMp = SpreadsheetApp.openById(sheetId).getSheetByName("Medpart") || SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
     var dataAll = sheetMp.getDataRange().getValues();
     var found = false;
     var instansi = "";
     for (var i = 0; i < dataAll.length; i++) {
         if (dataAll[i][1] === idMp) { 
             found = true; 
             instansi = dataAll[i][3];
             break; 
         }
     }
     
     if (!found) {
         var errId = sendMessage(chatId, "❌ Gagal: ID Media Partner *" + idMp + "* tidak ditemukan!\nSilakan ketik ulang ID yang benar atau ketik `/batal`.");
         trackMsg(userId, errId);
         return true;
     }
     
     cache.remove("WIZ_STATE_" + userId);
     
     var textBaru = "⚙️ *Edit Media Partner " + idMp + " (" + instansi + ")*\n\nBagian mana yang ingin kamu lengkapi atau ubah?";
     var keyboard = { inline_keyboard: [
         [{ text: "🔗 Syarat (Link Bukti)", callback_data: "MEDPART_SET|SYARAT|" + idMp }],
         [{ text: "🖼️ Poster Final (Foto)", callback_data: "MEDPART_SET|POSTER|" + idMp }],
         [{ text: "🗓️ Tanggal Upload", callback_data: "MEDPART_SET|TGL|" + idMp }],
         [{ text: "🔙 Batal", callback_data: "MENU_UPDATE_MEDPART_LIST" }]
     ]};
     
     clearWizardMessages(chatId, userId);
     var botMsgId = sendMessage(chatId, textBaru, keyboard);
     if (botMsgId) cache.put("LAST_MENU_" + chatId, String(botMsgId), 21600);
     return true;
  }

  if (userState === "WIZ_EDIT_UND_ID") {
     var idSuratRaw = text.trim().toUpperCase();
     var idSurat = idSuratRaw;
     if (!idSurat.startsWith("U")) idSurat = "U" + idSurat.padStart(2, '0');
     
     var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
     var dataAll = sheet.getDataRange().getValues();
     var found = false;
     var instansi = "";
     for (var i = 0; i < dataAll.length; i++) {
         if (dataAll[i][1] === idSurat) { 
             found = true; 
             instansi = dataAll[i][3];
             break; 
         }
     }
     
     if (!found) {
         var errId = sendMessage(chatId, "❌ Gagal: ID Undangan *" + idSurat + "* tidak ditemukan!\nSilakan ketik ulang ID yang benar atau ketik `/batal`.");
         trackMsg(userId, errId);
         return true;
     }
     
     cache.remove("WIZ_STATE_" + userId);
     
     var textBaru = "⚙️ *Edit Undangan " + idSurat + " (" + instansi + ")*\n\nData apa yang ingin kamu ubah?";
     var keyboard = { inline_keyboard: [
         [{ text: "🏢 Pengirim", callback_data: "EDIT_UND_SET|PENGIRIM|" + idSurat }],
         [{ text: "📝 Kegiatan", callback_data: "EDIT_UND_SET|KEGIATAN|" + idSurat }],
         [{ text: "🗓️ Tanggal & Waktu", callback_data: "EDIT_UND_SET|WAKTU|" + idSurat }],
         [{ text: "📍 Lokasi", callback_data: "EDIT_UND_SET|LOKASI|" + idSurat }],
         [{ text: "🔙 Batal", callback_data: "MENU_EDIT_UNDANGAN" }]
     ]};
     
     clearWizardMessages(chatId, userId);
     var botMsgId = sendMessage(chatId, textBaru, keyboard);
     if (botMsgId) cache.put("LAST_MENU_" + chatId, String(botMsgId), 21600);
     return true;
  }

  if (userState.startsWith("WIZ_FOTO_UND|")) {
      var idSuratFoto = userState.split("|")[1];
      
      if (!msg || !msg.photo) {
          var errId = sendMessage(chatId, "❌ Itu bukan foto! Silakan ulangi dengan mengirimkan foto gambar, atau ketik /batal.");
          trackMsg(userId, errId);
          return true;
      }
      
      cache.remove("WIZ_STATE_" + userId);
      trackMsg(userId, userMessageId);
      
      var fileIdTelegram = msg.photo[msg.photo.length - 1].file_id;
      var directImageUrl = simpanFileKeDrive(fileIdTelegram, "Undangan");
      
      if (!directImageUrl) {
          sendMessage(chatId, "❌ Gagal menyimpan Bukti Kehadiran ke Google Drive.");
          clearWizardMessages(chatId, userId);
          return true;
      }
      
      var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
      var dataAll = sheet.getDataRange().getValues();
      var barisDitemukan = -1;
      for (var i = 0; i < dataAll.length; i++) {
          if (dataAll[i][1] === idSuratFoto) { barisDitemukan = i + 1; break; }
      }
      
      clearWizardMessages(chatId, userId);
      
      if(barisDitemukan !== -1) {
        sheet.getRange(barisDitemukan, 9).setFormula('=IMAGE("' + directImageUrl + '")');
        var balasan = "📸 *Bukti Kehadiran Berhasil Diupload!*\n\nTerima kasih atas laporannya. Fotonya sudah dipajang cantik oleh Monalissa di database PR! 💅\n_Surat ID: " + idSuratFoto + "_";
        kirimMenuUtama(chatId, balasan);
        if (grupChatId && String(chatId) !== String(grupChatId)) {
            sendPhoto(grupChatId, fileIdTelegram, balasan);
        }
      } else {
        kirimMenuUtama(chatId, "❌ Foto gagal diproses: ID Surat *" + idSuratFoto + "* tidak ditemukan di database.");
      }
      
      return true;
  }

  if (userState === "WIZ_ADMIN_BROADCAST") {
     cache.remove("WIZ_STATE_" + userId);
     trackMsg(userId, userMessageId);
     
     var sheetUser = SpreadsheetApp.openById(sheetId).getSheetByName("User_Bot");
     var dataUser = sheetUser.getDataRange().getValues();
     var count = 0;
     
     for (var u = 1; u < dataUser.length; u++) { 
       if (dataUser[u][0]) {
         sendMessage(dataUser[u][0], "📢 *PENGUMUMAN DARI ADMIN PR:*\n\n" + text);
         count++;
       }
     }
     clearWizardMessages(chatId, userId);
     kirimMenuUtama(chatId, "✅ Pesan broadcast berhasil dikirim ke " + count + " anggota.");
     return true;
  }

  if (userState.startsWith("WIZ_ADMIN_HAPUS|")) {
     var modul = userState.split("|")[1];
     var idHapusRaw = text.trim().toUpperCase();
     var idHapus = idHapusRaw;
     
     var hasStringId = false;
     var namaSheet = "";
     if (modul === "UNDANGAN") { namaSheet = "Undangan"; hasStringId = true; }
     else if (modul === "MEDPART") { namaSheet = "Medpart"; hasStringId = true; }
     else if (modul === "SPONSOR") { namaSheet = "Sponsorship"; }
     else if (modul === "PARTNER") { namaSheet = "Partnership"; }
     
     if (hasStringId) {
         if (modul === "UNDANGAN" && !idHapus.startsWith("U")) idHapus = "U" + idHapus.padStart(2, '0');
         else if (modul === "MEDPART" && !idHapus.startsWith("M")) idHapus = "M" + idHapus.padStart(2, '0');
     } else {
         idHapus = idHapus.replace(/[^0-9]/g, "");
     }
     
     var checkSheet = SpreadsheetApp.openById(sheetId).getSheetByName(namaSheet);
     if(!checkSheet && modul === "MEDPART") checkSheet = SpreadsheetApp.openById(sheetId).getSheetByName("Media Partner");
     
     if (!checkSheet) {
         var errId = sendMessage(chatId, "❌ Modul " + modul + " belum didukung (Sheet tidak ditemukan).");
         trackMsg(userId, errId);
         return true;
     }
     
     var dataAll = checkSheet.getDataRange().getValues();
     var found = false;
     var info = "";
     for (var i = 0; i < dataAll.length; i++) {
         if (hasStringId) {
             if (dataAll[i][1] === idHapus) { 
                 found = true; 
                 if (modul === "UNDANGAN") {
                     var wktRaw = dataAll[i][5];
                     var wktFormat = "";
                     if (wktRaw) {
                         wktFormat = (wktRaw instanceof Date) ? Utilities.formatDate(wktRaw, "Asia/Jakarta", "dd/MMM/yyyy HH:mm") : String(wktRaw);
                     }
                     var keg = dataAll[i][4] ? String(dataAll[i][4]).trim() : "(Kegiatan Kosong)";
                     var lok = dataAll[i][6] ? String(dataAll[i][6]).trim() : "(Lokasi Kosong)";
                     var wktStr = wktFormat ? wktFormat : "(Waktu Kosong)";
                     
                     info = "*" + (dataAll[i][3] || "Tanpa Pengirim") + "* - " + keg + "\n🗓️ *Waktu:* " + wktStr + "\n📍 *Lokasi:* " + lok;
                 } else {
                     info = dataAll[i][3] ? String(dataAll[i][3]).trim() : "(Data Kosong)"; // Medpart instansi
                 }
                 break; 
             }
         } else {
             if (String(dataAll[i][0]) === String(idHapus)) { 
                 found = true; 
                 info = dataAll[i][1]; // Kolom index 1 (Instansi)
                 break; 
             }
         }
     }
     
     if (!found) {
         var errId = sendMessage(chatId, "❌ Gagal: ID *" + idHapus + "* tidak ditemukan di database " + modul + ".\nKetik ID lain atau ketik `/batal`.");
         trackMsg(userId, errId);
         return true;
     }
     
     cache.remove("WIZ_STATE_" + userId);
     trackMsg(userId, userMessageId);
     
     var textBaru = "⚠️ *PERINGATAN MENGHAPUS DATA*\n\nKamu akan menghapus data " + modul + " secara permanen:\n*ID Data:* " + idHapus + "\n*Info:* " + info + "\n\n🚨 _Data yang sudah dihapus tidak akan bisa dipulihkan kembali dan penomoran akan dirapikan ulang!_\n\n*Apakah kamu yakin ingin menghapus data ini?*";
     var keyboard = { inline_keyboard: [
         [{"text": "✅ Ya, Hapus Permanen", "callback_data": "CONFIRM_HAPUS|" + modul + "|" + idHapus}],
         [{"text": "❌ Tidak, Batalkan", "callback_data": "MENU_ADMIN_HAPUS"}]
     ]};
     
     clearWizardMessages(chatId, userId);
     var botMsgId = sendMessage(chatId, textBaru, keyboard);
     if (botMsgId) cache.put("LAST_MENU_" + chatId, String(botMsgId), 21600);
     
     return true;
  }

  return false; // State tidak dikenali
}

// ==========================================
// 🛠️ FUNGSI WEBHOOK MANAGEMENT
// ==========================================

function checkWebhookStatus() {
  var url = "https://api.telegram.org/bot" + token + "/getWebhookInfo";
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var json = JSON.parse(res.getContentText());
  Logger.log("=== STATUS WEBHOOK TELEGRAM ===");
  Logger.log(JSON.stringify(json, null, 2));
  return json;
}

function resetWebhook(customUrl) {
  // Secara otomatis mengambil URL dari Script Properties (Key: WEBHOOK_URL)
  var finalUrl = customUrl ? customUrl : webAppUrlProperty;
  
  if (!finalUrl || finalUrl === "") {
    Logger.log("❌ ERROR: Anda belum memasang WEBHOOK_URL di Script Properties!");
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
function handleInfoCommand(chatId, inputInfo) {
    var cache = CacheService.getScriptCache();
    var lastMenuId = cache.get("LAST_MENU_" + chatId);
    if (lastMenuId) {
       UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/deleteMessage", {
           method: "post", contentType: "application/json", 
           payload: JSON.stringify({ chat_id: String(chatId), message_id: lastMenuId }), 
           muteHttpExceptions: true
       });
       cache.remove("LAST_MENU_" + chatId);
    }

    var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("Undangan");
    var data = sheet.getDataRange().getValues();

    var namaHariArr = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    var namaBulanArr = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

    var hariIni = new Date();
    hariIni.setHours(0,0,0,0);
    var tahunIni = hariIni.getFullYear();

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
      
      var keyboardEdit = { inline_keyboard: [
          [{ text: "⚙️ Update Mediapartner", callback_data: "MENU_UPDATE_MEDPART_LIST" }],
          [{ text: "🔙 Kembali", callback_data: "NAV_INFORMASI" }]
      ] };
      
      var botMsgId = null;
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
         if (pesanKirim.trim() !== "") botMsgId = sendMessage(chatId, pesanKirim.trim(), keyboardEdit);
      } else {
         botMsgId = sendMessage(chatId, finalMp.trim(), keyboardEdit);
      }
      
      if (botMsgId) {
          var cache = CacheService.getScriptCache();
          cache.put("LAST_MENU_" + chatId, String(botMsgId), 21600);
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

    if (count === 0) {
       if (mode === "mendatang") {
          return sendMessage(chatId, "✨ *Wah, jadwal kita lagi kosong nih!* ✨\n\nTidak ada undangan untuk dihadiri dalam waktu dekat. Waktunya tim PR istirahat cantik~ 💅");
       } else if (mode === "bulan") {
          return sendMessage(chatId, "📅 *REKAP UNDANGAN BULAN " + namaBulanArr[targetBulan].toUpperCase() + "* 📅\n\n_(Tidak ada data undangan untuk bulan ini)_");
       } else {
          return sendMessage(chatId, "📋 *SEMUA DATA UNDANGAN PR UKBA* 📋\n\n_(Belum ada data undangan di database)_");
       }
    }

    var headerInfo = "";
    if (mode === "mendatang") headerInfo = "📋 *UNDANGAN MENDATANG* 📋\n\n"; 
    else if (mode === "semua") headerInfo = "📋 *SEMUA DATA UNDANGAN PR UKBA* 📋\n\n";
    else headerInfo = "📅 *REKAP UNDANGAN BULAN " + namaBulanArr[targetBulan].toUpperCase() + "* 📅\n\n";

    var finalInfo = headerInfo + listUndangan;

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
}

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

function setupBotCommands() {
  var url = "https://api.telegram.org/bot" + token + "/setMyCommands";
  var commands = [
    { command: "start", description: "Buka menu utama / Reset bot (Monalissa)" }
  ];
  
  var payload = {
    commands: commands
  };
  
  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  Logger.log("Set Commands Response: " + response.getContentText());
}
