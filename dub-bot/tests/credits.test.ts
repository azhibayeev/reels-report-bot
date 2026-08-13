import { describe, expect, it } from "vitest";
import {
  estimateCredits,
  formatDuration,
  pickDelivery,
  TELEGRAM_UPLOAD_LIMIT,
  TELEGRAM_URL_LIMIT,
} from "../lib/credits";

describe("estimateCredits", () => {
  it("считает 2000 кредитов за минуту", () => {
    expect(estimateCredits(60)).toBe(2000);
  });

  it("округляет вверх — ElevenLabs не даёт скидку за неполную секунду", () => {
    expect(estimateCredits(10)).toBe(334);
  });

  it("отдаёт 0 для неизвестной длительности, чтобы не блокировать загрузку", () => {
    expect(estimateCredits(0)).toBe(0);
    expect(estimateCredits(Number.NaN)).toBe(0);
    expect(estimateCredits(-5)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("форматирует минуты и секунды", () => {
    expect(formatDuration(192)).toBe("3:12");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(0)).toBe("0:00");
  });
});

describe("pickDelivery", () => {
  it("до 20 МБ отдаёт ссылкой — Telegram скачает сам", () => {
    expect(pickDelivery(TELEGRAM_URL_LIMIT)).toBe("url");
    expect(pickDelivery(1024)).toBe("url");
  });

  it("от 20 до 50 МБ грузит через нашу функцию", () => {
    expect(pickDelivery(TELEGRAM_URL_LIMIT + 1)).toBe("upload");
    expect(pickDelivery(TELEGRAM_UPLOAD_LIMIT)).toBe("upload");
  });

  it("больше 50 МБ Telegram не примет — только ссылка текстом", () => {
    expect(pickDelivery(TELEGRAM_UPLOAD_LIMIT + 1)).toBe("link");
  });
});
