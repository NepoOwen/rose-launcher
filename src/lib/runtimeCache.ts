const cache = new Map<string, string>();

export const runtimeCache = {
  getItem(key: string): string | null {
    return cache.has(key) ? (cache.get(key) ?? null) : null;
  },

  setItem(key: string, value: string): void {
    cache.set(key, value);
  },

  removeItem(key: string): void {
    cache.delete(key);
  },

  hasItem(key: string): boolean {
    return cache.has(key);
  },
};
