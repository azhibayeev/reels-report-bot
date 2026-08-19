import { loadDefaultPosition } from "../../../lib/farm/style";
import { verifyBatchToken } from "../../../lib/farm/tokens";
import BatchForm from "./batch-form";

export const dynamic = "force-dynamic";

// Отдельного lib/config в этом проекте нет (в отличие от dub-bot), поэтому
// секрет читаем прямо здесь — файл всё равно единственный, кто его использует.
function requireSecret(): string {
  const value = process.env.FARM_TOKEN_SECRET;
  if (!value) throw new Error("FARM_TOKEN_SECRET is not set");
  return value;
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claim = verifyBatchToken(token, requireSecret(), Date.now());

  // Просроченный токен обязан оборвать всё до формы: иначе человек соберёт
  // пачку на гигабайт и узнает о просрочке только на последнем файле.
  if (!claim) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
        <h1>Ссылка недействительна</h1>
        <p>Отправь боту /batch, чтобы получить новую.</p>
      </main>
    );
  }

  // Дефолт задаётся командой /style в боте — читаем его здесь, чтобы форма
  // открылась с уже привычной для человека позицией хука, а не всегда с «верха».
  const defaultPosition = await loadDefaultPosition();

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 720 }}>
      <h1>Пачка роликов</h1>
      <p>
        Выбери видео-подложки и вставь тексты одним куском. Блоки разделяются строкой{" "}
        <code>---</code>: первая строка блока — хук, всё остальное — описание. Первый файл по
        имени идёт к первому блоку, второй — ко второму и так далее.
      </p>
      <pre
        style={{
          background: "#f4f4f4",
          padding: 12,
          borderRadius: 6,
          whiteSpace: "pre-wrap",
          fontSize: 14,
        }}
      >
{`Первый хук
Описание первого ролика, можно в несколько строк.
---
Второй хук
Описание второго ролика.`}
      </pre>
      <BatchForm token={token} defaultPosition={defaultPosition} />
    </main>
  );
}
