export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Map status codes to clear, actionable copy when the server message is generic. */
export function formatApiError(err: unknown, fallback = 'Request failed.'): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : fallback;
  }
  if (err.status === 429) {
    return err.message.includes('Too many')
      ? err.message
      : 'Too many requests. Wait a moment and try again.';
  }
  if (err.status === 409) {
    return err.message || 'That action is already in progress. Wait for it to finish.';
  }
  return err.message || fallback;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { 'content-type': 'application/json', ...options.headers },
      ...options
    });
  } catch {
    throw new ApiError('Could not reach the PagePulse server. Is it running?', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const serverMessage =
      body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error
        ? String((body.error as { message: unknown }).message)
        : '';
    let message = serverMessage || `Request failed (HTTP ${res.status}).`;
    if (res.status === 429 && !serverMessage) {
      message = 'Too many requests. Wait a moment and try again.';
    } else if (res.status === 409 && !serverMessage) {
      message = 'That action is already in progress. Wait for it to finish.';
    }
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });
export const patch = <T>(path: string, data: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const put = <T>(path: string, data: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(data) });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
