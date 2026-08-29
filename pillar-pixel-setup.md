# Пиксель Meta на quranyy.com/pillar — инструкция

Дата: 2026-08-21. Пиксель/датасет: **1026535366821080** (тот же, что у квиза pilar.quranyy.com).

## 1. Что уже есть в приложении

`/pillar` — отдельное Next-приложение (basePath `/pillar`), задеплоено через OpenNext на Cloudflare.
Разметка событий **уже написана автором приложения**. В бандле есть хелпер:

```js
function track(name, params) {
  if (typeof window.fbq === 'function')
    name === 'Lead' ? fbq('track', 'Lead', params) : fbq('trackCustom', name, params);
  window.ttq?.track?.(name, params);   // TikTok — если появится ttq
}
```

Карта событий:

| Событие | Тип | Когда | Параметры |
|---|---|---|---|
| `QuizStart` | custom | первый ответ на экране 1 | — |
| `QuizQ1` … `QuizQ7` | custom | переход на каждый вопрос | `question`: `ritme, bangun, berhenti, umrah, zakat, keputusan, pilihan` |
| `ResultReached` | custom | показан экран результата (Peta) | `map`, `code` |
| `Lead` | **standard** | клик по кнопке WhatsApp | `map`, `code`, `channel: "whatsapp"` |

Плюс приложение само собирает `utm_source/medium/campaign/content`, `fbclid`, `ttclid`, `referrer`, `user_agent`,
`locale` и шлёт их с `session` и `phase` (`answer` / `complete`) на свой `POST /pillar/api/lead/`.

## 2. Чего не хватает

**Базового кода пикселя.** В `<head>` страницы нет ни `connect.facebook.net`, ни TikTok —
значит `window.fbq` не существует и все вызовы выше молча уходят в никуда.
Ставим базовый код — вся разметка заработает разом, править приложение не нужно.

CSP на домене нет → ничего не блокирует. Zaraz на зоне пока выключен (`/cdn-cgi/zaraz/i.js` → 404).

## 3. Установка через Cloudflare Zaraz (без доступа к репозиторию)

Исходники `/pillar` лежат не у нас (в `eidillum/qurany-web` их нет ни в одной из 5 веток),
поэтому вставляем пиксель на границе Cloudflare — домен и так проксируется через него.

1. Cloudflare → зона **quranyy.com** → **Zaraz** → включить (доступен на всех планах, в т.ч. Free).
2. **Tools** → **Third-party tools** → **Add new tool** → **Custom HTML**.
3. Действие (Action): тип **Pageview**, в поле HTML вставить:

```html
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1026535366821080');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=1026535366821080&ev=PageView&noscript=1" /></noscript>
```

4. В том же действии **Add Field** → **Ignore SPA** → включить. Квиз ходит по шагам через query-параметры
   (`?ritme=terjadwal`) без перезагрузки; без этого флага код будет вставляться на каждом шаге заново.
5. **Triggers** → **Create trigger**, назвать `Pillar pageview`, две match-rule:

   | Rule type | Variable | Operation | Value |
   |---|---|---|---|
   | Match rule | URL pathname | Starts with | `/pillar` |
   | Match rule | Event Name | Equals | `Pageview` |

6. Привязать триггер к действию Custom HTML. Save & Publish.

**Важно:** пиксель ставим только на `/pillar`, чтобы не ловить трафик читалки Корана в тот же датасет
и не пересечься с PostHog на основном сайте (его не трогаем).

**Нюанс:** Zaraz грузится асинхронно, поэтому `fbq` появляется через ~100–300 мс после открытия страницы.
`QuizStart` срабатывает только на первом клике (человек сначала читает вопрос), так что на практике не теряем.
Если захотим гарантию — снippet надо вписывать в `layout` приложения, а это уже нужен доступ к репозиторию.

## 4. Проверка

- Chrome → Meta Pixel Helper на `https://quranyy.com/pillar/`: должен показать PageView и ID 1026535366821080.
- Events Manager → **Test Events** → открыть квиз, пройти до конца: PageView → QuizStart → QuizQ1…QuizQ7 →
  ResultReached → Lead (по клику на WhatsApp).
- В консоли: `typeof fbq` → `"function"`.

## 5. Настройка в Events Manager

- Оптимизировать кампании на **Lead** (стандартное событие, клик по WhatsApp).
- Custom conversions из кастомных событий — для воронки и ретаргета:
  - `Pillar — Start` ← `QuizStart`
  - `Pillar — Result` ← `ResultReached`
  - `Pillar — Q4` ← `QuizQ4` (середина воронки, для оценки отвала)
- Верифицировать домен **quranyy.com** в Business Manager и расставить приоритеты Aggregated Event
  Measurement (iOS): Lead выше ResultReached выше QuizStart.
- Учитывать: `Lead` = клик по кнопке WhatsApp, а не факт отправленного сообщения. Реальные диалоги
  сверяем по `/pillar/api/lead/` (там `session`, `phase: complete`, `map`, `code`).

## 6. Фаза 2 — серверный CAPI (нужен доступ к репозиторию /pillar)

Эндпоинт `/pillar/api/lead/` уже получает `fbclid`, `user_agent`, UTM и фазу — это готовый источник
для Conversions API. Нужно: слать оттуда `Lead`/`ResultReached` на Graph API с общим `event_id`
(браузер + сервер) → дедуп, чинит потери на iOS. Токен и код можно взять из `~/Desktop/pilar-qurany`
(`lib/capi.ts`, `/api/capi`) — там тот же пиксель.

Кто автор приложения `/pillar` — выяснить у команды (Абылай/Рафи, GitLab `eidillum`); в `qurany-web`
его нет, деплой идёт отдельным OpenNext-воркером.
