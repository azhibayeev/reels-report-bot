import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Только собственный набор корневого проекта: без этого discovery забирал и
    // dub-bot/tests — у того свой проект, свои зависимости и свой vitest.config.
    include: ["tests/**/*.test.ts"],
  },
});
