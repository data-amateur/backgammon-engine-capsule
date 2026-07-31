import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const server = createServer(async (request, response) => {
  const path = request.url === "/host.js" ? "host.js" : "index.html";
  try {
    const body = await readFile(join(fixtureDirectory, path));
    response.writeHead(200, {
      "Content-Type":
        path === "host.js"
          ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(3100, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
