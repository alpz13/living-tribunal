import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/__test__/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    reporters: ["default", ["html", { outputDir: "./html-report" }]],
  },
});
