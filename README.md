# Serverless Telegram PR Bot (Monalissa)

A serverless Telegram Bot architecture built on Google Apps Script (GAS), utilizing Google Sheets as a real-time relational database. **Monalissa** automates Public Relations operations, handling CRUD tasks for event delegations, partnership management (Media Partners & Sponsorships), file uploads via Drive API, and automated cron-job reminders.

## Features

- **Event Delegation (`/a`, `/i`, `/info`)**: Seamlessly input new events, assign delegations, and view upcoming events. Bot includes an intelligent inline keyboard system when searching for ambiguous names.
- **Withdraw Delegation (`/tarik`)**: Delegates can withdraw their attendance from an event in case of schedule conflicts, automatically updating the attendance recap.
- **Edit Records (`/edit`)**: Modify event details (Time, Location, Activity, Sender) directly from Telegram chat without touching the database sheet.
- **Automated Evidence Collection (`/f`)**: Delegates can upload photo evidence which gets automatically formatted and displayed on Google Sheets using the Google Drive API.
- **Interactive Cleanup for Inactive Delegations**: An automated cron job `hapusDelegasiTanpaBukti()` detects past events over 3 days old and notifies the PR Group. Admins can interactively approve (`[Hapus]`) or wave (`[Pertahankan]`) the evidence requirement via Inline Keyboards.
- **Partnership Management (`/mp`, `/sp`, `/pt`)**: Easily record details for Media Partners, Sponsorships, and General Partnerships right from Telegram into your database.
- **Data Deletion (`/hapus`)**: Fast and persistent row deletion right from the chat with automatic sequence numbering (NO column) adjustment.

## Prerequisites & Setup

1. **Google Apps Script**: Create a new Google Apps Script project attached to your master Google Sheet.
2. **File Structure**: Copy the contents of `Code.gs` into your Apps Script project.
3. **Environment Variables**: Fill in the required global variables at the top of the script:
   - `token`: Your Telegram Bot API Token from BotFather.
   - `sheetId`: The ID of your Google Sheet.
   - `grupChatId`: The Telegram Group Chat ID for broadcast notifications.
   - `folderId`: The Google Drive folder ID to store uploaded photo evidence.
   - `adminIds`: An array of Telegram User IDs for Admin privileges (used for auto-cleanup confirmation).
4. **Deploy as Web App**:
   - Deploy the script as a Web App (Execute as: "Me", Access: "Anyone").
   - Register the resulting Web App URL to your Telegram Bot using the `setWebhook` API.
5. **Set up Triggers**:
   - Set up a time-driven trigger (cron) for `reminderDelegasi()` to run daily (e.g. morning).
   - Set up a time-driven trigger for `hapusDelegasiTanpaBukti()` to run daily (e.g. midnight).
   - Set up a time-driven trigger for `rekapBulanan()` to run on the 1st of every month.

## Commands

- `/start` or `/tutor`: Show help and command list.
- `/i [Pengirim], [Kegiatan], [Tgl/Bln], [Jam Menit], [Lokasi]`: Input new invitation.
- `/a [ID_Surat] [Nama]`: Claim a delegation slot.
- `/tarik [ID_Surat] [Nama]`: Withdraw a delegation.
- `/edit [ID_Surat] [Kolom] [Nilai_Baru]`: Edit event data (Kolom: Pengirim, Kegiatan, Waktu, Lokasi).
- `/info [semua/bulan]`: View events database.
- `/f [ID_Surat]`: Upload photo evidence (as caption).
- `/hapus [ID_Surat]`: Permanently delete a record.
- `/mp`, `/sp`, `/pt`: Manage partnerships with forms.
- `/daftar [Nama Lengkap]`: Register account for direct messages.
- `/broadcast [Pesan]`: Broadcast message to all registered members (Admin only).
