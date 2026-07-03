export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function badRequest(message, details = undefined) {
  return json({ error: message, details }, { status: 400 });
}

export function notFound(message = "Not found") {
  return json({ error: message }, { status: 404 });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function requiredDb(env) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured");
  }
  return env.DB;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

export function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
