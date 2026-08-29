/**
 * Qurany IG — плагин для листа «Кандидаты».
 * Автозаполняет по @нику из колонки B: подписчиков (E), ср. комментарии (G),
 * платформу (C); на ячейку с ником вешает заметку (БИО, ср. лайки, число постов).
 * Просмотры (F) и качественную оценку API не даёт — остаются ручными.
 *
 * Движок: Instagram Business Discovery (Facebook Graph API). Видит только
 * Business/Creator-аккаунты; личные/приватные → помечаются красным «проверь вручную».
 *
 * Настройка (один раз): Extensions → Apps Script → Project Settings → Script Properties:
 *   IG_TOKEN — постоянный Page-токен (даёт Клод)
 *   IG_ID    — id аккаунта, ОТ которого запрашиваем (daristeppe = 17841413773053161)
 */

var SHEET_NAME = "Кандидаты";
var GRAPH = "https://graph.facebook.com/v21.0";
var API_VERSION_NOTE = "Business Discovery";

// Колонки листа «Кандидаты» (1 = A)
var COL = { handle: 2, platform: 3, followers: 5, comments: 7 };

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Qurany IG")
    .addItem("Обновить выделенные строки", "updateSelectedRows")
    .addItem("Обновить все пустые (по подписчикам)", "updateEmptyRows")
    .addSeparator()
    .addItem("Проверить токен", "checkToken")
    .addToUi();
}

function props_() { return PropertiesService.getScriptProperties(); }
function token_() { return props_().getProperty("IG_TOKEN"); }
function igId_()  { return props_().getProperty("IG_ID"); }

function checkToken() {
  var ui = SpreadsheetApp.getUi();
  var t = token_(), ig = igId_();
  if (!t || !ig) { ui.alert("Не заданы IG_TOKEN / IG_ID в Script Properties."); return; }
  var r = fetchProfile_("instagram", t, ig); // пробный аккаунт
  ui.alert(r.ok ? "Токен рабочий ✅ (тест @instagram: " + r.followers + " подписчиков)"
                : "Ошибка: " + r.error);
}

/** Обновить только выделенные строки. */
function updateSelectedRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var rng = sheet.getActiveRange();
  if (!rng) return;
  var rows = [];
  for (var r = rng.getRow(); r <= rng.getLastRow(); r++) rows.push(r);
  run_(sheet, rows);
}

/** Обновить все строки, где есть @ник, но пусто в «Подписчики» (E). */
function updateEmptyRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var last = sheet.getLastRow();
  var handles = sheet.getRange(1, COL.handle, last, 1).getValues();
  var followers = sheet.getRange(1, COL.followers, last, 1).getValues();
  var rows = [];
  for (var i = 0; i < last; i++) {
    var h = String(handles[i][0] || "").trim();
    if (h.charAt(0) === "@" && !followers[i][0]) rows.push(i + 1);
  }
  run_(sheet, rows);
}

function run_(sheet, rows) {
  var ui = SpreadsheetApp.getUi();
  var t = token_(), ig = igId_();
  if (!t || !ig) { ui.alert("Сначала задай IG_TOKEN и IG_ID в Script Properties."); return; }

  var ok = 0, fail = 0, skipped = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var raw = String(sheet.getRange(row, COL.handle).getValue() || "").trim();
    if (raw.charAt(0) !== "@") { skipped++; continue; }
    var handle = raw.replace(/^@/, "").replace(/\/.*$/, "").trim();

    var res = fetchProfile_(handle, t, ig);
    var cell = sheet.getRange(row, COL.handle);
    if (res.ok) {
      sheet.getRange(row, COL.followers).setValue(res.followers);
      if (res.avgComments != null) sheet.getRange(row, COL.comments).setValue(res.avgComments);
      if (!sheet.getRange(row, COL.platform).getValue()) sheet.getRange(row, COL.platform).setValue("Instagram");
      cell.setNote(
        "БИО: " + (res.bio || "—") +
        "\nСр. лайки: " + (res.avgLikes != null ? res.avgLikes : "—") +
        "\nПостов: " + (res.mediaCount != null ? res.mediaCount : "—") +
        "\nОбновлено: " + new Date().toLocaleString("ru-RU")
      );
      cell.setBackground(null);
      ok++;
    } else {
      cell.setBackground("#f4cccc"); // красный — не Business/не найден
      cell.setNote("Нет данных (" + res.error + ").\nЛичный/приватный аккаунт — проверь вручную.\n" + new Date().toLocaleString("ru-RU"));
      fail++;
    }
    Utilities.sleep(1200); // не долбить лимиты API
  }
  ui.alert("Готово. Обновлено: " + ok + " · не найдено/личные: " + fail + " · пропущено: " + skipped);
}

/** Один запрос Business Discovery. Возвращает {ok, followers, avgComments, avgLikes, bio, mediaCount} или {ok:false, error}. */
function fetchProfile_(handle, token, igId) {
  var fields = "business_discovery.username(" + handle + ")" +
    "{username,followers_count,media_count,biography,media.limit(12){media_type,like_count,comments_count}}";
  var url = GRAPH + "/" + igId + "?fields=" + encodeURIComponent(fields) + "&access_token=" + encodeURIComponent(token);
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var j = JSON.parse(resp.getContentText());
    if (j.error) return { ok: false, error: j.error.message };
    var b = j.business_discovery;
    if (!b) return { ok: false, error: "нет данных" };
    var media = (b.media && b.media.data) ? b.media.data : [];
    var avgComments = null, avgLikes = null;
    if (media.length) {
      var c = 0, l = 0;
      for (var i = 0; i < media.length; i++) { c += (media[i].comments_count || 0); l += (media[i].like_count || 0); }
      avgComments = Math.floor(c / media.length);
      avgLikes = Math.floor(l / media.length);
    }
    return {
      ok: true,
      followers: b.followers_count,
      mediaCount: b.media_count,
      bio: (b.biography || "").replace(/\s+/g, " ").slice(0, 200),
      avgComments: avgComments,
      avgLikes: avgLikes
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
