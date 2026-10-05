export declare const DEV_JWT_SECRET: string;
export declare const DEV_ANON_KEY: string;
export declare const DEV_SERVICE_ROLE_KEY: string;
export declare function signDevJwt(payload: Record<string, unknown>, secret?: string): string;
