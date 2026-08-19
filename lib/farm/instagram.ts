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
  if (!res.ok) throw new Error(`IG контейнер не создан: ${await readError(res)}`);
  const { id } = (await res.json()) as { id?: string };
  if (!id) throw new Error("IG контейнер не создан: в ответе нет id");
  return id;
}

export async function waitForContainer(
  containerId: string,
  deps: PublishDeps,
  opts?: { timeoutMs?: number }
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (opts?.timeoutMs ?? CONTAINER_TIMEOUT_MS);

  for (;;) {
    const res = await fetch(
      `${G}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(deps.token)}`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error(`IG не отдал статус контейнера: ${await readError(res)}`);
    const { status_code: code, status } = (await res.json()) as { status_code?: string; status?: string };

    if (code === "FINISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(`IG отбраковал ролик (${code}): ${status ?? "без деталей"}`);
    }
    if (Date.now() >= deadline) throw new Error("IG не дождался готовности контейнера");
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function publishContainer(containerId: string, deps: PublishDeps): Promise<string> {
  const body = new URLSearchParams({ creation_id: containerId, access_token: deps.token });
  const res = await fetch(`${G}/${deps.igUserId}/media_publish`, { method: "POST", body });
  if (!res.ok) throw new Error(`IG не опубликовал ролик: ${await readError(res)}`);
  const { id } = (await res.json()) as { id?: string };
  if (!id) throw new Error("IG не опубликовал ролик: в ответе нет id");
  return id;
}

export async function fetchPermalink(mediaId: string, deps: PublishDeps): Promise<string> {
  const res = await fetch(
    `${G}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(deps.token)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return "";
  const { permalink } = (await res.json()) as { permalink?: string };
  return permalink ?? "";
}
