export async function downloadBlobFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  const blob    = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href     = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
}
