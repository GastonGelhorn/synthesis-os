/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

const certPath = path.resolve(__dirname, "./src-tauri/cert.pem");
const keyPath = path.resolve(__dirname, "./src-tauri/key.pem");
const hasTLS = fs.existsSync(certPath) && fs.existsSync(keyPath);
const enableHttps = process.env.HTTPS_DEV === "1" && hasTLS;
 
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
    https: enableHttps
      ? {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        }
      : undefined,
    proxy: {
      "/api": { target: "http://localhost:3939", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
