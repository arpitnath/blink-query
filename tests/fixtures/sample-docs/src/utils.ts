export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function createServer(port: number) {
  return {
    port,
    listen: () => console.log(`Listening on :${port}`),
    close: () => console.log('Server closed'),
  };
}
