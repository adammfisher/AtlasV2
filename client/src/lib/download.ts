/**
 * Bulletproof artifact downloads: fetch → blob → anchor with an explicit
 * filename. Immune to Content-Disposition quirks, MIME-type guessing, proxy
 * header handling, and sandbox download blocking — the name and bytes come
 * straight from our own code.
 */
export async function saveFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
