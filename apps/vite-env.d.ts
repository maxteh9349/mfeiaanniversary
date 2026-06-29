/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which backend the build targets: "local" (default) or "supabase". */
  readonly VITE_BACKEND?: "local" | "supabase";
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Public origin of the deployed site, used to build the check-in QR URL. */
  readonly VITE_PUBLIC_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
