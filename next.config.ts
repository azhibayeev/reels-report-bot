import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Канвас — нативный модуль: сборщик не умеет класть .node в ESM-чанк, поэтому
  // он остаётся внешним и подгружается из node_modules в рантайме.
  serverExternalPackages: ["@napi-rs/canvas"],
  // Бинарники ffmpeg лежат в node_modules и не попадают в трассировку сами:
  // без этого рендер на Vercel падает с ENOENT.
  outputFileTracingIncludes: {
    "/api/farm/render": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/**",
      // SIL OFL 1.1 требует, чтобы уведомление о лицензии сопровождало
      // каждую копию шрифта — бандл рендера тоже его копия.
      "./assets/hook.ttf",
      // Нативный модуль канваса резолвится по платформе в рантайме, поэтому
      // трассировка его не видит — ровно так же, как не видела ffmpeg.
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      "./node_modules/@napi-rs/canvas/**",
      "./assets/hook.ttf.LICENSE.txt",
    ],
  },
};

export default nextConfig;
