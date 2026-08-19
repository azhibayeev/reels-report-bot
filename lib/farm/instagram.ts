// Facebook Login, а не graph.instagram.com: trial_params живёт здесь — проверено
// на живом аккаунте 19.08.2026, оба контейнера создались.
const G = "https://graph.facebook.com/v23.0";

export interface PublishDeps {
  token: string;
  igUserId: string;
  sleep?: (ms: number) => Promise<void>;
}

const POLL_INTERVAL_MS = 10_000;
const CONTAINER_TIMEOUT_MS = 4 * 60_000;

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return parsed.error?.message || text;
  } catch {
    return text;
  }
}

export async function createTrialContainer(
  videoUrl: string,
  caption: string,
  deps: PublishDeps
): Promise<string> {
  const body = new URLSearchParams({
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    // Ролик уходит только не-подписчикам; выпуск в ленту остаётся ручным
    // решением в приложении.
    trial_params: JSON.stringify({ graduation_strategy: "MANUAL" }),
    access_token: deps.token,
  });

  const res = await fetch(`${G}/${deps.igUserId}/media`, { method: "POST", body });
  // HTTP-код в тексте ошибки — не для человека в чате, а для postOne: только
  // так он надёжно отличает временный 429/5xx (слот остаётся за роликом) от
  // постоянного отказа (creation_id, права и т.п.), не заглядывая в res.status
  // напрямую — эта функция его наружу не отдаёт.
  if (!res.ok) throw new Error(`IG контейнер не создан (HTTP ${res.status}): ${await readError(res)}`);
  const { id } = (await res.json()) as { id?: string };
  if (!id) throw new Error("IG контейнер не создан: в ответе нет id");
  return id;
}

// Разовая пятисотка/сетевой обрыв на опросе не должны отменять уже созданный
// контейнер — Graph отдаёт такие сбои и посреди нормального ожидания. Терпим
// подряд идущие неудачные попытки, а не любую вообще: если Graph реально лёг
// надолго, ждать до CONTAINER_TIMEOUT_MS молча — хуже, чем сообщить раньше.
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export async function waitForContainer(
  containerId: string,
  deps: PublishDeps,
  opts?: { timeoutMs?: number }
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts?.timeoutMs ?? CONTAINER_TIMEOUT_MS);
  let consecutiveFailures = 0;
  let lastFailureReason = "";

  for (;;) {
    let code: string | undefined;
    let status: string | undefined;
    try {
      const res = await fetch(
        `${G}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(deps.token)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`IG не отдал статус контейнера (HTTP ${res.status}): ${await readError(res)}`);
      ({ status_code: code, status } = (await res.json()) as { status_code?: string; status?: string });
    } catch (error) {
      consecutiveFailures += 1;
      lastFailureReason = (error as Error).message;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new Error(`IG не отдал статус контейнера ${MAX_CONSECUTIVE_POLL_FAILURES} раза подряд: ${lastFailureReason}`);
      }
      if (Date.now() >= deadline) throw new Error("IG не дождался готовности контейнера");
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    consecutiveFailures = 0;

    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      // Отбраковка ролика — окончательный вердикт Graph, а не сбой опроса:
      // повторять тут нечего, ждать не нужно.
      throw new Error(`IG отбраковал ролик (${code}): ${status ?? "без деталей"}`);
    }
    if (Date.now() >= deadline) throw new Error("IG не дождался готовности контейнера");
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function publishContainer(containerId: string, deps: PublishDeps): Promise<string> {
  const body = new URLSearchParams({ creation_id: containerId, access_token: deps.token });
  const res = await fetch(`${G}/${deps.igUserId}/media_publish`, { method: "POST", body });
  if (!res.ok) throw new Error(`IG не опубликовал ролик (HTTP ${res.status}): ${await readError(res)}`);
  const { id } = (await res.json()) as { id?: string };
  if (!id) throw new Error("IG не опубликовал ролик: в ответе нет id");
  return id;
}

export async function fetchPermalink(mediaId: string, deps: PublishDeps): Promise<string> {
  // Ролик к этому моменту уже опубликован — падать нельзя ни при каком отказе,
  // но и молчать о причине нельзя: без лога «ссылку получить не удалось» в чате
  // ничего не объясняет. Поэтому и сетевой сбой, и не-ok Graph логируются здесь,
  // а наружу неизменно возвращается "".
  try {
    const res = await fetch(
      `${G}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(deps.token)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      console.error("farm fetchPermalink: Graph отказал", mediaId, await readError(res));
      return "";
    }
    const { permalink } = (await res.json()) as { permalink?: string };
    return permalink ?? "";
  } catch (error) {
    console.error("farm fetchPermalink: сетевой сбой", mediaId, error);
    return "";
  }
}
