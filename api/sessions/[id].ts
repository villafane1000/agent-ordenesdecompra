import { getSesion } from "../../src/http.js";

export async function GET(req: Request) {
  const id = new URL(req.url).pathname.split("/").pop() ?? "";
  return getSesion(decodeURIComponent(id));
}
