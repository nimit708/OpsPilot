const transient = new Set([408, 425, 429, 500, 502, 503, 504]);
export class HttpError extends Error { constructor(message, status, details) { super(message); this.name="HttpError"; this.status=status; this.details=details; } }

export async function request(url, options = {}) {
  const { retries = 3, timeoutMs = 15000, fetchImpl = fetch, ...init } = options;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text(); let data = text;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (response.ok) return { data, headers: response.headers, status: response.status };
      if (attempt < retries && transient.has(response.status)) {
        const retryAfter = Number(response.headers.get("retry-after") || 0) * 1000;
        await new Promise(r => setTimeout(r, retryAfter || Math.min(250 * 2 ** attempt, 2000))); continue;
      }
      throw new HttpError(`HTTP ${response.status} from ${new URL(url).hostname}`, response.status, data);
    } catch (error) {
      if (error instanceof HttpError || attempt >= retries) throw error;
      await new Promise(r => setTimeout(r, Math.min(250 * 2 ** attempt, 2000)));
    } finally { clearTimeout(timer); }
  }
}
