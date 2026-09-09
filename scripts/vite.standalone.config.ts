import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

export default defineConfig({
  root,
  plugins: [viteReact(), tailwindcss()],
  resolve: {
    alias: { "@": path.join(root, "src") },
  },
  base: "./",
  build: {
    outDir: path.join(root, "dist-helios"),
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: path.join(root, "scripts/helios-standalone.html"),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
