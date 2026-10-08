// Servidor local: `bun run dev` o `npm run dev` → http://localhost:3000 (front + API en un comando).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { getHealth, getSesion, postChat } from "../src/http.js";

const PORT = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let r: Response;
  if (url.pathname === "/api/chat" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    r = await postChat(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) }));
  } else if (url.pathname === "/api/health") r = getHealth();
  else if (url.pathname.startsWith("/api/sessions/")) r = getSesion(decodeURIComponent(url.pathname.split("/").pop() ?? ""));
  else {
    try { r = new Response(await readFile(new URL("../public/index.html", import.meta.url)), { headers: { "content-type": "text/html; charset=utf-8" } }); }
    catch { r = new Response("No encontrado", { status: 404 }); }
  }
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log(`Agente OC en http://localhost:${PORT}`));
