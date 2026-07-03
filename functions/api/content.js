import { content } from "../_lib/demo-data.js";
import { json } from "../_lib/http.js";

export async function onRequestGet() {
  return json(content);
}
