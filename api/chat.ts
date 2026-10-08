import { postChat } from "../src/http.js";

export async function POST(req: Request) {
  return postChat(req);
}
