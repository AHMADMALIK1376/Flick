// Low-level HTTP helper. Pages should not call this directly: use the
// functions in ./flick.ts instead.
import { connection } from './connection';

/** An error with a message that is safe to show to the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Body = FormData | object | undefined;

export async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const headers: Record<string, string> = { 'X-Flick-Token': connection.token };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body; // the browser sets the multipart header itself
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(connection.httpBase + path, { method, headers, body: payload });
  } catch {
    throw new ApiError('Flick is not running. Start the backend and try again.', 0);
  }

  if (!res.ok) {
    throw new ApiError(await errorMessage(res), res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) return 'Flick could not connect (wrong token).';
  try {
    const data = await res.json();
    // FastAPI puts friendly messages in "detail".
    if (typeof data?.detail === 'string') return data.detail;
  } catch {
    // not JSON
  }
  return 'Something went wrong. Please try again.';
}
