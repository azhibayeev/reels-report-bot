import { NextRequest, NextResponse } from "next/server";
import { escapeHtml } from "../../../lib/format";
import { sendMessage } from "../../../lib/telegram";
import {
  checkSite,
  fbIsBad,
  fbMoney,
  FB_DISABLE_REASON_LABEL,
  FB_STATUS_LABEL,
  fetchFbAccount,
  loadState,
  resolveFbToken,
  saveState,
  type MonitorState,
} from "../../../lib/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const jakarta = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const at = () => `${jakarta.format(new Date())} (WIB)`;

function alertThread(): number | undefined {
  const t = process.env.TELEGRAM_ALERT_THREAD_ID;
  return t ? Number(t) : undefined;
}
async function alert(html: string): Promise<void> {
  await sendMessage(html, { thread: alertThread() ?? null });
}

function monitorUrls(): string[] {
  const raw = process.env.MONITOR_URLS;
  if (raw && raw.trim()) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ["https://pilar.quranyy.com/", "https://pilar.quranyy.com/kuis"];
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;

  // Разовое создание форум-темы «⚠️ Alerts» (бот должен быть админом с правом «управление темами»).
  if (sp.get("createtopic") === "1") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) return NextResponse.json({ error: "bot env missing" }, { status: 500 });
    const r = await fetch(`https://api.telegram.org/bot${token}/createForumTopic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, name: "⚠️ Alerts", icon_color: 0xff93a3 }),
    });
    const j = (await r.json()) as { ok: boolean; result?: { message_thread_id: number }; description?: string };
    if (!j.ok) return NextResponse.json({ ok: false, error: j.description }, { status: 400 });
    return NextResponse.json({ ok: true, message_thread_id: j.result?.message_thread_id });
  }

  // Проверка проводки: разовый тестовый алерт в тему «⚠️ Alerts».
  if (sp.get("test") === "1") {
    await alert(`✅ <b>Монитор Qurany на связи</b>\nТест-сообщение. ${at()}`);
    return NextResponse.json({ ok: true, test: "sent" });
  }

  const state = await loadState();
  const results: Record<string, unknown> = { sites: {}, fb: null };
  const alerts: string[] = [];

  // ── Сайты ──────────────────────────────────────────────────────────────────
  for (const url of monitorUrls()) {
    const { ok, code } = await checkSite(url);
    const prev = state.sites[url];
    results.sites = { ...(results.sites as object), [url]: { ok, code } };

    if (!ok && (!prev || !prev.down)) {
      state.sites[url] = { down: true, since: new Date().toISOString(), code };
      alerts.push(
        `🔴 <b>САЙТ НЕ ОТВЕЧАЕТ</b>\n${escapeHtml(url)}\nКод: ${code ?? "нет ответа / таймаут"}\n${at()}`
      );
    } else if (ok && prev && prev.down) {
      const downMin = Math.round((Date.now() - new Date(prev.since).getTime()) / 60000);
      state.sites[url] = { down: false, since: new Date().toISOString(), code };
      alerts.push(
        `🟢 <b>Сайт снова работает</b>\n${escapeHtml(url)}\nБыл недоступен ~${downMin} мин.\n${at()}`
      );
    } else {
      state.sites[url] = { down: !ok, since: prev?.since ?? new Date().toISOString(), code };
    }
  }

  // ── Facebook Ads ────────────────────────────────────────────────────────────
  const fbToken = await resolveFbToken();
  const fbAccount = process.env.META_AD_ACCOUNT_ID;
  if (fbToken && fbAccount) {
    try {
      const acc = await fetchFbAccount(fbToken, fbAccount);
      const bad = fbIsBad(acc.account_status);
      const prevBad = state.fb?.bad ?? false;
      const statusLabel = FB_STATUS_LABEL[acc.account_status] ?? `код ${acc.account_status}`;
      const reasonLabel =
        acc.disable_reason && acc.disable_reason !== 0
          ? FB_DISABLE_REASON_LABEL[acc.disable_reason] ?? `код ${acc.disable_reason}`
          : null;
      results.fb = { status: acc.account_status, statusLabel, bad };

      if (bad && (!prevBad || state.fb?.status !== acc.account_status)) {
        alerts.push(
          `🔴 <b>FACEBOOK ADS: проблема с аккаунтом</b>\n` +
            `Аккаунт: ${escapeHtml(acc.name ?? fbAccount)}\n` +
            `Статус: <b>${escapeHtml(statusLabel)}</b>\n` +
            (reasonLabel ? `Причина: ${escapeHtml(reasonLabel)}\n` : "") +
            `Баланс: ${escapeHtml(fbMoney(acc.balance, acc.currency))}\n` +
            `⚠️ Открутка рекламы может быть остановлена. Проверьте оплату в Ads Manager.\n${at()}`
        );
      } else if (!bad && prevBad) {
        alerts.push(`🟢 <b>Facebook Ads: аккаунт снова активен</b>\n${escapeHtml(acc.name ?? fbAccount)}\n${at()}`);
      }
      state.fb = {
        status: acc.account_status,
        reason: acc.disable_reason ?? null,
        bad,
        since: state.fb && state.fb.bad === bad ? state.fb.since : new Date().toISOString(),
      };
    } catch (e) {
      results.fb = { error: String(e) };
      // Ошибка самого API (протух токен и т.п.) — тоже сигнал, но алертим один раз.
      const errKey = state.fb?.reason;
      if (errKey !== -1) {
        alerts.push(
          `🟠 <b>Монитор не смог проверить Facebook Ads</b>\n${escapeHtml(String(e)).slice(0, 300)}\n` +
            `Возможно, истёк токен доступа. ${at()}`
        );
        state.fb = { status: null, reason: -1, bad: state.fb?.bad ?? false, since: new Date().toISOString() };
      }
    }
  }

  // ── Отправка ────────────────────────────────────────────────────────────────
  if (sp.get("status") !== "1") {
    for (const msg of alerts) {
      try {
        await alert(msg);
      } catch {
        /* не роняем весь цикл из-за одной ошибки отправки */
      }
    }
    await saveState(state as MonitorState);
  }

  return NextResponse.json({ ok: true, alertsSent: sp.get("status") === "1" ? 0 : alerts.length, results });
}
