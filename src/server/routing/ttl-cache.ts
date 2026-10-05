/**
 * Caché en memoria con caducidad y tamaño máximo (por instancia). Para la
 * resolución host → tienda (TTL 60 s, §21.1): datos públicos, nunca datos que
 * dependan de la autorización (§44.7).
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      // Map conserva el orden de inserción: el primero es el más antiguo.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }
}
