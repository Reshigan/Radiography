export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

let practiceOverride: string | null = null;
export function setPracticeHeader(id: string | null) {
  practiceOverride = id;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (practiceOverride) headers['x-practice-id'] = practiceOverride;
  const res = await fetch(path.startsWith('/api') ? path : `/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'include' });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'error', json?.message ?? `Request failed (${res.status})`, json?.details);
  return json as T;
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  delete: <T = any>(path: string) => request<T>('DELETE', path),
};
