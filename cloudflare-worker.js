/**
 * Cloudflare Worker Telegram Webhook Proxy untuk Google Apps Script (Monalissa Bot)
 * 
 * Fungsi:
 * 1. Menerima request webhook dari Telegram Bot API.
 * 2. Meneruskan (forward) request ke Google Apps Script Web App dengan parameter `redirect: "follow"`.
 * 3. Mencegah status 302 dilihat oleh Telegram, sehingga antrean pesan tidak pernah nyangkut (clogged).
 * 4. Merespon Telegram dengan status 200 OK.
 */

// GANTI URL DI BAWAH DENGAN WEB APP URL GOOGLE APPS SCRIPT ANDA
const GAS_WEBAPP_URL = "https://script.google.com/macros/s/GANTI_DENGAN_DEPLOYMENT_ID_ANDA/exec";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint tes kesehatan proxy via browser (GET)
    if (request.method === "GET") {
      return new Response("Monalissa Telegram Webhook Proxy is Running! 💅", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // Hanya teruskan request POST dari Telegram
    if (request.method === "POST") {
      try {
        const payload = await request.text();

        // Target URL: ambil dari Environment Variable jika ada, atau gunakan konstanta di atas
        const targetUrl = (env && env.GAS_URL) ? env.GAS_URL : GAS_WEBAPP_URL;

        // Forward request ke Google Apps Script sambil mengikuti redirect 302
        const gasResponse = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: payload,
          redirect: "follow", // <-- KUNCI UTAMA: Mengikuti redirect 302 dari Google secara transparan
        });

        // Selalu kembalikan 200 OK ke Telegram agar antrean tidak pernah tersendat
        return new Response("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (err) {
        // Sekalipun terjadi error koneksi sementara ke Google, balas 200 ke Telegram agar antrean tidak macet
        return new Response("OK", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
