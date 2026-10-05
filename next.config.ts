import type { NextConfig } from "next";

import { parseServerEnv } from "./src/config/env";

// Falla el build (y el arranque) si falta o es inválida una variable de entorno.
parseServerEnv(process.env);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
