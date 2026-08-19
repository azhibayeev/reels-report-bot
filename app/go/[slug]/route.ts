import { NextRequest, NextResponse } from "next/server";
import { appLinkConfig, buildTargetUrl, detectPlatform, sanitizeSlug } from "../../../lib/applink";
import { recordAppLinkClick } from "../../../lib/applink-store";

export const dynamic = "force-dynamic";

// Короткая ссылка амбассадора: /go/bara → его стор с меткой источника.
// Метка нужна, чтобы Play и App Store потом показали установки в разрезе людей.
export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const slug = sanitizeSlug((await ctx.params).slug);
  if (!slug) return NextResponse.json({ error: "unknown link" }, { status: 404 });

  const cfg = appLinkConfig();
  const platform = detectPlatform(req.headers.get("user-agent"));
  const target = buildTargetUrl(platform, slug, cfg);

  // Свой счётчик переходов: отчёты сторов приходят с задержкой в сутки-двое, а
  // движение по неделе нужно видеть сегодня. Сбой учёта не должен мешать человеку
  // дойти до стора, поэтому ошибка гасится здесь же.
  try {
    await recordAppLinkClick(slug, platform, new Date());
  } catch (e) {
    console.error(`app link click not recorded (${slug}):`, e);
  }

  // Редирект нельзя кэшировать: закэшированный ответ не дошёл бы до счётчика.
  const noStore = { "Cache-Control": "no-store, max-age=0" };

  if (target) return NextResponse.redirect(target, { status: 302, headers: noStore });

  // Компьютер: выбрать за человека нельзя — показываем варианты.
  return new NextResponse(desktopPage(slug), {
    status: 200,
    headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" },
  });
}

function desktopPage(slug: string): string {
  const cfg = appLinkConfig();
  const play = buildTargetUrl("android", slug, cfg)!;
  const ios = buildTargetUrl("ios", slug, cfg)!;
  const iosLabel = cfg.iosLive ? "App Store (iPhone)" : "iPhone — gabung komunitas dulu";
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qurany</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0f766e; color:#fff; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { text-align:center; padding:40px 28px; max-width:420px; }
  h1 { font-size:24px; margin:0 0 8px; }
  p { opacity:.85; margin:0 0 28px; line-height:1.5; }
  a { display:block; padding:16px; margin:12px 0; border-radius:12px; background:#fff; color:#0f766e;
      text-decoration:none; font-weight:600; }
</style>
</head>
<body>
  <div class="card">
    <h1>Qurany</h1>
    <p>Buka halaman ini di ponsel Anda, atau pilih toko aplikasi di bawah.</p>
    <a href="${play}">Google Play (Android)</a>
    <a href="${ios}">${iosLabel}</a>
  </div>
</body>
</html>`;
}
