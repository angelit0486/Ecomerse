/**
 * Contrato del almacenamiento de medios que usa el worker. La implementación
 * con service_role vive en src/server/privileged/storage-admin.ts (SR-2); las
 * pruebas usan una en memoria.
 */
export const MEDIA_BUCKETS = ["store-uploads", "store-media"] as const;
export type MediaBucket = (typeof MEDIA_BUCKETS)[number];

export interface StorageAdmin {
  /** Contenido del objeto, o null si no existe. Lanza ObjectTooLargeError si supera `maxBytes`. */
  download(bucket: MediaBucket, path: string, maxBytes: number): Promise<Buffer | null>;
  upload(bucket: MediaBucket, path: string, data: Buffer, contentType: string): Promise<void>;
  remove(bucket: MediaBucket, paths: string[]): Promise<void>;
}

export class ObjectTooLargeError extends Error {
  constructor() {
    super("Objeto mayor que el máximo permitido");
    this.name = "ObjectTooLargeError";
  }
}

/**
 * Ruta generada por media_create_upload, o una de sus copias en varios tamaños
 * (paso 8: `{ruta}.w{ancho}.webp`, solo los anchos de VARIANT_WIDTHS); cualquier
 * otra forma se rechaza.
 */
const MEDIA_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z_]{1,20}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/original\.(jpg|png|webp|avif)(\.w(320|640|960|1280)\.webp)?$/;

export function isMediaPath(path: string): boolean {
  return MEDIA_PATH_RE.test(path);
}

/** Toda ruta de los buckets de medios empieza por un store_id y no sale del bucket. */
export function isStorePrefixedPath(path: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^\0]{1,480}$/.test(path) &&
    !path.includes("..")
  );
}
