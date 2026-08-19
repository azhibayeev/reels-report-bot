import { listItems } from "../../../../lib/farm/store";
import { verifyBatchToken } from "../../../../lib/farm/tokens";
import { Item } from "../../../../lib/farm/types";

export const dynamic = "force-dynamic";

function requireSecret(): string {
  const secret = process.env.FARM_TOKEN_SECRET;
  if (!secret) throw new Error("FARM_TOKEN_SECRET is not set");
  return secret;
}

const TZ = process.env.FARM_TZ || "Asia/Jakarta";

const dayFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: TZ,
  day: "numeric",
  month: "long",
  weekday: "short",
});
const timeFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL: Record<Item["status"], string> = {
  pending: "в очереди на сборку",
  rendering: "собирается",
  review: "ждёт вашего решения",
  editing: "правится описание",
  rejected: "отклонён",
  queued: "запланирован",
  posting: "публикуется",
  posted: "опубликован",
  failed: "сбой",
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!verifyBatchToken(token, requireSecret(), Date.now())) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 760 }}>
        <h1>Ссылка недействительна</h1>
        <p>Отправь боту /reels, чтобы получить новую.</p>
      </main>
    );
  }

  const items = await listItems();
  const scheduled = items
    .filter((i) => i.scheduledAt && ["queued", "posting", "posted"].includes(i.status))
    .sort((a, b) => Date.parse(a.scheduledAt as string) - Date.parse(b.scheduledAt as string));

  // Группируем по дню публикации: человеку важно «сегодня осталось столько,
  // завтра столько», а не сплошной список из тридцати строк.
  const byDay = new Map<string, Item[]>();
  for (const item of scheduled) {
    const day = dayFmt.format(new Date(item.scheduledAt as string));
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }

  const waiting = items.filter((i) => i.status === "review");
  const working = items.filter((i) => i.status === "pending" || i.status === "rendering");
  const failed = items.filter((i) => i.status === "failed");

  const cell = { padding: "6px 10px", borderBottom: "1px solid #e3e8e4", verticalAlign: "top" as const };

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 760, lineHeight: 1.5 }}>
      <h1>Запланированный контент</h1>
      <p style={{ color: "#566b60" }}>
        Время по {TZ}. Ждут решения: {waiting.length} · собираются: {working.length} · со сбоем:{" "}
        {failed.length}
      </p>

      {scheduled.length === 0 && <p>Пока ничего не запланировано — одобрите ролики кнопкой ✅.</p>}

      {[...byDay.entries()].map(([day, dayItems]) => (
        <section key={day} style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>
            {day} — {dayItems.length}{" "}
            {dayItems.length === 1 ? "ролик" : dayItems.length < 5 ? "ролика" : "роликов"}
          </h2>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <tbody>
              {dayItems.map((item) => (
                <tr key={item.itemId}>
                  <td style={{ ...cell, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {timeFmt.format(new Date(item.scheduledAt as string))}
                  </td>
                  <td style={cell}>{item.hook}</td>
                  <td style={{ ...cell, whiteSpace: "nowrap", color: "#566b60" }}>
                    {item.permalink ? (
                      <a href={item.permalink} target="_blank" rel="noreferrer">
                        опубликован
                      </a>
                    ) : (
                      STATUS_LABEL[item.status]
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {failed.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>Со сбоем</h2>
          <ul style={{ paddingLeft: "1.2rem" }}>
            {failed.map((item) => (
              <li key={item.itemId}>
                {item.hook} — {item.error ?? "без деталей"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
