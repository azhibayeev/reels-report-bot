import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Бинарники ffmpeg лежат в node_modules и не попадают в трассировку сами:
  // без этого рендер на Vercel падает с ENOENT.
  outputFileTracingIncludes: {
    "/api/farm/render": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/**",
      // SIL OFL 1.1 требует, чтобы уведомление о лицензии сопровождало
      // каждую копию шрифта — бандл рендера тоже его копия.
      "./assets/hook.ttf",
      "./assets/hook.ttf.LICENSE.txt",
    ],
  },
};

export default nextConfig;
