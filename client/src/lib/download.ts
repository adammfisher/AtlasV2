/**
 * Bulletproof artifact downloads: fetch → blob → anchor with an explicit
 * filename. Immune to Content-Disposition quirks, MIME-type guessing, proxy
 * header handling, and sandbox download blocking — the name and bytes come
 * straight from our own code.
 */
export async function saveFile(url: string, filename: string): Promise<void> {
  // probe first so a missing file surfaces as a real error, not a silent click
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) {
    const res = await fetch(url);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `download failed (${res.status})`);
  }
  // direct navigation download: the server's Content-Disposition attachment
  // header names the file. Unlike blob URLs this is never subject to Chrome's
  // multiple-automatic-downloads block (the earlier UUID downloads can trip it,
  // silently killing every blob download afterward).
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
