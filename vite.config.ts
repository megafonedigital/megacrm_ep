import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv, type Plugin } from "vite";

const configDir = dirname(fileURLToPath(import.meta.url));
const serverEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

// Stubs `shiki` (and its WASM-loading internals) in any non-client build
// environment. Without this, the Cloudflare Worker bundle pulls in
// `wasm/onig-*.wasm` and crashes on boot with "No such module" — breaking
// every SSR page, webhook and cron.
function stubShikiOnServer(): Plugin {
  const STUB_ID = "\0virtual:shiki-server-stub";
  const STUB_CODE = `
    const noop = () => {};
    const empty = { tokens: [], bg: "transparent", fg: "inherit" };
    const fakeHighlighter = {
      codeToTokens: () => empty,
      codeToHtml: () => "",
      getLoadedLanguages: () => [],
      getLoadedThemes: () => [],
      dispose: noop,
    };
    export const createHighlighter = () => Promise.resolve(fakeHighlighter);
    export const getHighlighter = createHighlighter;
    export const createHighlighterCore = createHighlighter;
    export const getSingletonHighlighter = createHighlighter;
    export const createJavaScriptRegexEngine = () => ({});
    export const createOnigurumaEngine = () => Promise.resolve({});
    export const createWasmOnigEngine = () => Promise.resolve({});
    export const loadWasm = () => Promise.resolve();
    export const bundledLanguages = {};
    export const bundledThemes = {};
    export const bundledLanguagesInfo = [];
    export const bundledThemesInfo = [];
    export default { createHighlighter };
  `;
  return {
    name: "lovable:stub-shiki-on-server",
    enforce: "pre",
    resolveId(source, _importer, options) {
      const envName = (this as unknown as { environment?: { name?: string } })?.environment?.name;
      const isServer = options?.ssr === true || (envName != null && envName !== "client");
      if (!isServer) return null;
      if (source === "shiki" || source.startsWith("shiki/")) {
        return STUB_ID;
      }
      return null;
    },
    load(id) {
      if (id === STUB_ID) return STUB_CODE;
      return null;
    },
  };
}

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Deploy fora do Cloudflare (Docker/EasyPanel): NITRO_PRESET=node-server
  // troca o alvo do build. Sem a env, mantém o padrão do Lovable
  // (cloudflare-module) — nada muda para o Lovable Deploy.
  ...(process.env.NITRO_PRESET
    ? { nitro: { preset: process.env.NITRO_PRESET } }
    : {}),
  vite: {
    plugins: [stubShikiOnServer()],
    resolve: {
      alias: {
        "entities/lib/decode.js": resolve(configDir, "node_modules/entities/lib/decode.js"),
        "entities/lib/encode.js": resolve(configDir, "node_modules/entities/lib/encode.js"),
      },
      dedupe: [],
    },
  },
});
