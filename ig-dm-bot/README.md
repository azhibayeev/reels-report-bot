# IG DM follow-gate бот (свой ManyChat)

Ловит кодовое слово в комментах рилсов @daristeppe → шлёт DM с follow-gate:
подписан → ссылка, не подписан → «сначала подпишись».

Прод: **https://ig-dm-bot-zeta.vercel.app** · Vercel проект `ig-dm-bot`.

## Как работает (поток, как в ManyChat)
1. Кто-то пишет коммент `ikut` (или `halal`) под любым рилсом.
2. Бот шлёт **опенинг-DM** с кнопкой «Kirim link-nya 🔗» + публичный ответ под комментом.
3. Юзер тапает кнопку → бот проверяет подписку (`is_user_follow_business`):
   - **подписан** → DM со ссылкой `https://go.quranyy.com/gabung`
   - **не подписан** → DM «Link ini spesial buat followers… follow dulu» + кнопка снова.
4. Юзер подписывается, тапает ещё раз → получает ссылку.

## ❗ Что осталось сделать (1 шаг, руками в дашборде)
Meta нужно сказать, куда слать вебхуки. В приложении **qurany-2** → **Webhooks** (или Instagram → API setup → Webhooks):
- **Callback URL:** `https://ig-dm-bot-zeta.vercel.app/api/webhook`
- **Verify token:** значение env `VERIFY_TOKEN` (лежит в Vercel → Settings → Environment Variables)
- Нажать **Verify and Save**, затем подписаться на поле **`comments`** (и `messages`, если есть).

Подписка аккаунта на события уже сделана через API (`/me/subscribed_apps` = comments,messages).

## Проверить, что работает
С другого IG-аккаунта коммент `Ikut` под рилсом → должен прийти опенинг-DM с кнопкой. Тап → follow-gate.
Здоровье: `GET /api/setup?key=<CRON_SECRET>` → `{ok:true, account:"daristeppe", ...}`.

## Что и где менять
Всё — через **Vercel → Project ig-dm-bot → Settings → Environment Variables**, потом `vercel deploy --prod`:
| Переменная | Что |
|---|---|
| `KEYWORDS` | кодовые слова через запятую (`ikut,halal`) |
| `LINK` | финальная ссылка |
| `DM_OPENING` | текст опенинг-DM |
| `DM_FOLLOW_GATE` | текст «подпишись сначала» |
| `DM_LINK` | текст DM со ссылкой |
| `BTN_TITLE` | надпись на кнопке |

## Токен
Долгоживущий IG-Login токен (60 дней) в Vercel Blob. Крон `/api/refresh` (1-го числа месяца)
сам продлевает. Ручное продление: `GET /api/refresh?key=<CRON_SECRET>`.

## Файлы
- `api/webhook.js` — приём вебхуков (комменты + тапы кнопки).
- `api/refresh.js` — крон продления токена.
- `api/setup.js` — здоровье + сид токена в Blob.
- `lib/config.js` — тексты, слова, ссылка (или через env).
- `lib/ig.js` — DM, кнопка, проверка подписки, публичный ответ.
- `lib/token.js` — хранение/продление токена (Blob).

## Ограничение
IG-Login API не отдаёт СПИСОК старых комментов (только новые через вебхук). Историю
(для разовой рассылки по старым лидам) читает только Facebook-токен — см. `recover-leads.mjs`.
