import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DURATION_SEC } from "../lib/media";

// upload-form.tsx — клиентский компонент и держит собственную константу
// MAX_DURATION_SEC локально, не импортируя её из lib/media.ts: тот модуль
// тянет node:fs через lib/binaries.ts и не должен попасть в браузерный
// бандл. Ту же причину нельзя развернуть в обратную сторону: этот тест не
// импортирует upload-form.tsx как модуль (JSX-компонент под "use client"),
// а читает файл текстом и вытаскивает число регэкспом — тест обязан
// оставаться чистым Node-кодом без сборки React/JSX.
//
// У числа с двумя владельцами в этом проекте уже была история молчаливого
// рассинхрона: ширина колонки субтитров и кегль шрифта разъезжались точно
// так же (см. комментарии в lib/probe.ts и lib/cues.ts про SUBTITLE_FONTSIZE).
// Этот тест ловит ту же ошибку здесь: смени порог в lib/media.ts и забудь
// про клиент — тест покраснеет.
describe("порог длительности в upload-form.tsx", () => {
  it("совпадает с MAX_DURATION_SEC из lib/media.ts", () => {
    const source = readFileSync(
      join(process.cwd(), "app", "u", "[token]", "upload-form.tsx"),
      "utf8"
    );
    const match = source.match(/const MAX_DURATION_SEC\s*=\s*([\d.]+)\s*;/);
    expect(match).not.toBeNull();

    const clientValue = Number(match![1]);
    expect(clientValue).toBe(MAX_DURATION_SEC);
  });
});
