// ── Отправка событий воронки в PostHog (server-side, project token — write-only).
const PH_KEY = process.env.POSTHOG_KEY;
const PH_HOST = process.env.POSTHOG_HOST || "https://us.i.posthog.com";

export async function phCapture(event, distinctId, properties = {}) {
  if (!PH_KEY) return;
  try {
    await fetch(`${PH_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: PH_KEY,
        event,
        distinct_id: String(distinctId || "anon"),
        properties: { $lib: "qurany-ig-bot", ...properties },
      }),
    });
  } catch (e) {
    console.error("PH_ERR", e.message);
  }
}
