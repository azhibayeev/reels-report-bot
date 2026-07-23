# Состояние сборки деки (2026-07-23, v2 — рабочий аккаунт Figma)

Файл Figma (рабочий аккаунт Galamat, team::1568237263564784472, Pro/Full — 200 MCP-вызовов/день):
https://www.figma.com/design/ZcmwuCw5rVrjmJFs0qfPN0
Старый файл (личный аккаунт, недоступен): TSxi8pfM6BzyuzbKS44w6s — не использовать.

Страницы: Page 1 (0:1) — слайды; «· Библиотека компонентов» (1:2).

## Слайды (Page 1) — ВСЕ 20 СОБРАНЫ И ПРОВЕРЕНЫ СКРИНШОТАМИ (2026-07-23)
01 Обложка 5:2 · 02 1:60 (образец) · 03 6:4 · 04 6:48 · 05 7:56 · 06 7:103 · 07 8:113 ·
08 8:163 · 09 9:166 · 10 10:193 · 11 10:238 · 12 11:246 · 12а 11:290 · 12б 12:299 ·
12в 12:354 · 13 13:352 · 14 13:387 (фото-рамки отвязаны от компонента, укорочены) ·
15 14:393 · 16 14:438 (контакт-карточки FIXED 420) · 17 15:438
Доп. imageHash: app-home fd42851e…, qazaqstan bec2c0f6…, redart 320e9f40…, abylay eb4a49f4…,
alan f8b37c33…, QR 5020397c…, mushaf c74d86f8…, mosque 1495f093…, doomscroll 30c5aff6…, логотипы 4f29b7ff…/f503b015…

## Библиотека компонентов (страница 1:2)
- Badge/Gold — 1:5 · Badge/Outline — 1:8 · Badge/Ghost — 1:11
- Framed-Number — 1:14
- Stat-Card — 1:21 (число 52, label 19, паддинги 24/20, gap 8)
- Stat-Card/Hero — 1:28 (число 168, label 24, паддинги 36/30, gap 10)
- Callout — 1:33 (текст 19, внутр. паддинги 18)
- Compare-Block — 1:41
- Image-Frame/Arch — 1:44 (внутр. нода 'photo', 440×600, арка 232)
- Section-Bar/Top — 1:50 · Section-Bar/Footer — 1:57

## Рецепт слайда (образец 1:60)
Vertical auto-layout 1920×1080, padding 110/110/60/44, gap 28, fill = imageHash фона.
1. Section-Bar/Top instance (FILL) — override текстов бейджей.
2. Headline-Highlight: text Playfair SemiBold 88 cream + плашка (gold, арка 30/6, padding 34/6/34/14) с выделенными словами (Playfair 88, тёмный изумруд #082A1F).
3. main HORIZONTAL gap 40 (FILL/FILL): col-left FILL (Hero + Callout) · col-mid FIXED 560 gap 18 (Callout-эпиграф Lora Italic 23 + Stat-Card ×2) · Image-Frame/Arch (layoutSizingVertical FILL).
4. Section-Bar/Footer instance (FILL).
Текст-оверрайды: instance.findAll(n=>n.type==='TEXT'), загрузить шрифты до правки.

## Мотив и палитра
Арка-михраб: большой radius TL/BR, малый TR/BL. Изумруд #0B3A2A, крем #F5F1E8, золото #CD9E49 (0.804/0.62/0.286), тёмный изумруд #082A1F. Шрифты: Playfair Display, Inter, Lora Italic, Amiri (арабский — только живым текстом).

## imageHash (уже в файле ZcmwuCw5rVrjmJFs0qfPN0)
- Фон изумруд+гирих: 3c5cb27b44885b39cba1ba27f7d58dfe038010cc
- Руки+телефон: 6b9e449532604c69849cdc6e764a0133f469c857
На диске (presentation/assets/): bg-emerald-1/2, photo-mushaf, photo-hands-phone, photo-mosque + логотипы (qurany-logo, galamat-logo), фото (abylay, alan), qurany-app-home, qazaqstan-instagram, redart-appstore, testflight-qr.

## Следующие шаги
1. Аппрув образца 1:60 пользователем.
2. Тираж на остальные 19 слайдов по мастер-тексту presentation/slides-master-ru.md
   (1 обложка с басмалой Amiri, 3–4 проблемы/решение, 5–11, 12+12а/б/в кейсы, 13–17).
   Для светлых «рабочих» слайдов при необходимости — кремовая инверсия системы.
3. Генерация недостающей графики GPT Image 2 (model gpt_image_2) по мере слайдов.
4. Финальные скриншоты всех слайдов → правки → PDF.
