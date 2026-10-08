import { getHealth } from "../src/http.js";

export async function GET() {
  return getHealth();
}
