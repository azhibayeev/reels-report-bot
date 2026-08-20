import { REQUIRED_SCOPES, TokenCheck } from "./token-report";

/**
 * Установка ключа публикации: обмен временного ключа из Explorer на бессрочный
 * токен Страницы.
 *
 * Зачем внутри бота, а не руками. Бессрочным токен Страницы становится только
 * если выведен из долгоживущего пользовательского, а тот получается обменом
 * через секрет приложения. Секрет лежит в переменных Vercel и наружу не
 * отдаётся — значит обмен может сделать только сам сервис. Иначе человеку
 * пришлось бы либо присылать секрет в чат (хуже, чем токен), либо каждые
 * два часа вручную обновлять ключ, живущий ровно столько.
 */

export interface SetupDeps {
  appId: string | undefined;
  appSecret: string | undefined;
  igUserId: string | undefined;
  exchangeForLongLived: (shortToken: string, appId: string, appSecret: string) => Promise<string>;
  fetchPageToken: (userToken: string, igId: string) => Promise<string>;
  checkToken: (token: string) => Promise<TokenCheck>;
  saveToken: (token: string) => Promise<void>;
}

export interface SetupResult {
  ok: boolean;
  message: string;
}

/** Ключ Explorer — длинная строка без пробелов; проверяем до похода в Graph. */
export function looksLikeToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{50,}$/.test(value);
}

export async function installFarmToken(shortToken: string, deps: SetupDeps): Promise<SetupResult> {
  if (!looksLikeToken(shortToken)) {
    return { ok: false, message: "Это не похоже на ключ: нужна длинная строка без пробелов из Graph API Explorer." };
  }
  if (!deps.appId || !deps.appSecret) {
    return { ok: false, message: "Не заданы META_APP_ID и META_APP_SECRET — без них обмен на бессрочный ключ невозможен." };
  }
  if (!deps.igUserId) {
    return { ok: false, message: "Не задан FARM_IG_ID — непонятно, для какого аккаунта искать страницу." };
  }

  let longLived: string;
  try {
    longLived = await deps.exchangeForLongLived(shortToken, deps.appId, deps.appSecret);
  } catch (error) {
    return { ok: false, message: `Обмен не прошёл: ${(error as Error).message}` };
  }

  let pageToken: string;
  try {
    pageToken = await deps.fetchPageToken(longLived, deps.igUserId);
  } catch (error) {
    return { ok: false, message: `Страница аккаунта не найдена: ${(error as Error).message}` };
  }

  // Проверяем ДО сохранения. Записать негодный ключ поверх годного — это
  // сломать заливку тем самым действием, которым её чинят.
  let check: TokenCheck;
  try {
    check = await deps.checkToken(pageToken);
  } catch (error) {
    return { ok: false, message: `Не удалось проверить полученный ключ: ${(error as Error).message}` };
  }
  if (!check.valid) {
    return { ok: false, message: "Graph отдал ключ, но тут же признал его недействительным — ключ не сохранён." };
  }
  const missing = REQUIRED_SCOPES.filter((s) => !check.scopes.includes(s));
  if (missing.length) {
    return {
      ok: false,
      message: `У полученного ключа нет прав: ${missing.join(", ")}. Выдайте их в Explorer и пришлите ключ заново.`,
    };
  }

  await deps.saveToken(pageToken);

  // expires_at = 0 у бессрочных. Если срок всё же есть, ключ работать будет,
  // но молчать об этом нельзя: человек уйдёт в уверенности, что настроил
  // навсегда, и заливка встанет посреди пачки.
  const forever = check.expiresAt === null;
  return {
    ok: true,
    message: forever
      ? "Ключ обменян на бессрочный и сохранён. Заливка пойдёт со следующего тика."
      : `Ключ сохранён, но он НЕ бессрочный: истекает ${new Date(check.expiresAt as number).toISOString()}. ` +
        "Обычно это значит, что в Explorer выдан ключ без нужных прав на страницу.",
  };
}
