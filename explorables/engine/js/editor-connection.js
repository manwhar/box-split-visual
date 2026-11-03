/** Read the file and its save capability together; a plain HTTP 200 isn't a writable server. */
export async function connectEditorFile(url, { expectedSignature, signatureOf, fetcher = fetch }) {
  try {
    const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    if (signatureOf(source) !== expectedSignature) {
      return { status: "conflict", reason: "The slides changed on disk. Download your draft, then reload before saving." };
    }
    const revision = response.headers.get("X-Deck-Revision"), token = response.headers.get("X-Deck-Token");
    return { status: revision && token ? "ready" : "read-only", file: { source, revision, token } };
  } catch {
    return { status: "offline", reason: "Cannot connect to the local server. Your draft is kept; restart it with python3 explorables/serve.py and click Reconnect." };
  }
}
