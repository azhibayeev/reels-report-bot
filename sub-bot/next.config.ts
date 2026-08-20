import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/probe": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/**",
      "./assets/**",
    ],
    "/api/sub/render": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffprobe-static/bin/**",
      "./assets/**",
    ],
    "/api/sub/start": [
      "./node_modules/ffprobe-static/bin/**",
      "./assets/glossary.ru-id.json",
    ],
  },
};

export default nextConfig;
