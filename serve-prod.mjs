import { createServer } from "node:http";
import { createReadStream, statSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { createGzip, createBrotliCompress } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".output", "public");
const PORT = 8094;
const indexFallback = join(ROOT, "index.html");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt"]);

const server = createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url?.split("?")[0] || "/");
  if (urlPath === "/") urlPath = "/index.html";

  let filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // SPA-style fallback for routes without a file (serves pre-rendered index.html)
  if (!existsSync(filePath)) {
    if (existsSync(indexFallback)) {
      filePath = indexFallback;
    } else {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
  }

  const ext = extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";
  const stat = statSync(filePath);
  const canCompress = COMPRESSIBLE.has(ext);
  const acceptEnc = req.headers["accept-encoding"] || "";

  let headers = {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  if (canCompress) {
    if (acceptEnc.includes("br")) {
      delete headers["Content-Length"];
      headers["Content-Encoding"] = "br";
      res.writeHead(200, headers);
      createReadStream(filePath).pipe(createBrotliCompress()).pipe(res);
      return;
    }
    if (acceptEnc.includes("gzip")) {
      delete headers["Content-Length"];
      headers["Content-Encoding"] = "gzip";
      res.writeHead(200, headers);
      createReadStream(filePath).pipe(createGzip()).pipe(res);
      return;
    }
  }

  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Production preview with gzip/brotli on http://localhost:${PORT}/`);
});
