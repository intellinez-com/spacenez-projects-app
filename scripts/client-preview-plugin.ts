import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import type { Plugin } from "vite";

// Small original illustration for the fictional project, not a client site photo.
function sampleRoomPng() {
  const width = 640, height = 360;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = y < 245 ? [235, 229, 215] : [186, 157, 125];
      if (x > 65 && x < 240 && y > 45 && y < 210) color = [168, 193, 190];
      if (x > 148 && x < 155 && y > 45 && y < 210 || y > 125 && y < 132 && x > 65 && x < 240) color = [247, 244, 235];
      if (x > 310 && x < 570 && y > 210 && y < 305) color = [131, 143, 125];
      if (x > 325 && x < 553 && y > 190 && y < 263) color = [153, 162, 145];
      if (x > 395 && x < 410 && y > 190 && y < 263 || x > 475 && x < 490 && y > 190 && y < 263) color = [131, 143, 125];
      if (x > 120 && x < 265 && y > 283 && y < 303) color = [97, 76, 59];
      if ((x > 130 && x < 140 || x > 245 && x < 255) && y >= 303 && y < 340) color = [97, 76, 59];
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = color[0]!; pixels[offset + 1] = color[1]!; pixels[offset + 2] = color[2]!;
    }
  }
  function chunk(type: string, data: Buffer) {
    const content = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4);
    header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, content, tail]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

export function clientPreviewPlugin(): Plugin {
  let enabled = false;
  return {
    name: "spacenez-local-client-preview",
    enforce: "pre",
    config(_config, env) {
      if (env.mode !== "client-preview") return;
      if (env.command !== "serve") throw new Error("Client preview is local-only. Use the normal production build for deployment.");
      enabled = true;
      return {
        resolve: { alias: [{ find: /^@\/integrations\/supabase\/client$/, replacement: fileURLToPath(new URL("../src/preview/client.ts", import.meta.url)) }] },
        server: { host: "127.0.0.1", port: 4173, strictPort: true },
      };
    },
    configureServer(server) {
      if (!enabled) return;
      const illustration = sampleRoomPng();
      server.middlewares.use((request, response, next) => {
        // Preview SDK mutations happen in memory; block real app server actions entirely.
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 403;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ error: "Server actions are disabled in the local client preview." }));
          return;
        }
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        if (!path.startsWith("/__client-preview/") && !path.startsWith("/storage/v1/object/sign/project-files/")) return next();
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (path.endsWith("/sample-room.png")) {
          response.setHeader("Content-Type", "image/png"); response.end(illustration);
        } else if (path.endsWith("/sample-document.txt")) {
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("FICTIONAL CLIENT PREVIEW\n\nSample design brief\nLiving area: warm neutral finishes, a seating area and natural light.\nNext step: review the proposed layout with the design team.\n\nThis is sample content for a usability review. No real client files are shown.\n");
        } else { response.statusCode = 404; response.end("Unknown preview file"); }
      });
    },
  };
}
