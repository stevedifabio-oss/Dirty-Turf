import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("production service worker", () => {
  it("precaches startup and lazy assets from the Vite manifest", async () => {
    const source = await readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
    const listeners = new Map();
    const cached = new Set();
    const manifest = {
      "index.html": { file: "assets/index.js", css: ["assets/index.css"] },
      "src/components/Academy.tsx": { file: "assets/Academy.js" },
    };
    const context = vm.createContext({
      console,
      Error,
      Object,
      Promise,
      Response,
      Set,
      URL,
      caches: {
        open: async () => ({ put: async (key) => cached.add(String(key)) }),
        keys: async () => [],
        delete: async () => true,
        match: async () => undefined,
      },
      fetch: async (input) => String(input) === "/vite-manifest.json"
        ? new Response(JSON.stringify(manifest), { status: 200 })
        : new Response(String(input) === "/" ? '<html><script src="/assets/index.js"></script></html>' : `asset:${input}`, { status: 200, headers: { "content-type": String(input).endsWith(".js") ? "application/javascript" : String(input).endsWith(".css") ? "text/css" : "text/html" } }),
      self: {
        addEventListener: (type, listener) => listeners.set(type, listener),
        clients: { claim: async () => undefined },
        location: { origin: "https://app.dirtyturf.com" },
        skipWaiting: () => undefined,
      },
    });
    vm.runInContext(source, context);

    const waits = [];
    listeners.get("install")({ waitUntil: (promise) => waits.push(promise) });
    await Promise.all(waits);

    expect(cached).toContain("/");
    expect(cached).toContain("/assets/index.js");
    expect(cached).toContain("/assets/index.css");
    expect(cached).toContain("/assets/Academy.js");
    expect(cached).toContain("/support.html");
    expect(cached).toContain("/delete-account.html");
  });
});
