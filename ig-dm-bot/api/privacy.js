// Простая страница политики конфиденциальности (нужна, чтобы опубликовать Meta-приложение).
export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy Policy — Qurany</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}h1{font-size:24px}h2{font-size:18px;margin-top:28px}</style>
</head><body>
<h1>Privacy Policy / Kebijakan Privasi</h1>
<p>Terakhir diperbarui: 2026-07-28</p>
<p>Layanan ini adalah asisten otomatis untuk akun Instagram <b>@daristeppe</b> (Qurany). Kami menghormati privasi Anda.</p>
<h2>Data yang kami proses</h2>
<p>Ketika Anda menulis komentar dengan kata kunci tertentu pada postingan kami, atau mengirim pesan ke akun kami, kami memproses: username Instagram Anda, ID komentar/pesan, dan status apakah Anda mengikuti akun kami — semata-mata untuk mengirimkan balasan otomatis dan tautan yang Anda minta melalui Direct Message.</p>
<h2>Penggunaan</h2>
<p>Data hanya digunakan untuk merespons interaksi Anda secara otomatis. Kami tidak menjual data Anda kepada pihak ketiga.</p>
<h2>Penyimpanan</h2>
<p>Kami menyimpan ID interaksi secukupnya untuk mencegah pengiriman pesan ganda. Anda dapat berhenti kapan saja dengan tidak berinteraksi lagi.</p>
<h2>Penghapusan data</h2>
<p>Untuk permintaan penghapusan data, hubungi kami melalui DM Instagram <b>@daristeppe</b>.</p>
<hr>
<p style="color:#888;font-size:13px">This service is an automated assistant for the Instagram account @daristeppe. We process your Instagram username and comment/message IDs only to send you the automated reply and link you requested. We do not sell your data. For data deletion, contact us via Instagram DM @daristeppe.</p>
</body></html>`);
}
