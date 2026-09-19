/** Display helpers shared by client components. */

export function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return "unknown time";
  const timestamp = new Date(isoString).getTime();
  if (!Number.isFinite(timestamp)) return "unknown time";
  const diffMs = Date.now() - timestamp;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(isoString).toLocaleDateString();
}
