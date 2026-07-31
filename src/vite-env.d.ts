/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOWED_PARENT_ORIGINS?: string;
  readonly VITE_CAPSULE_PUBLIC_ORIGIN?: string;
  readonly VITE_BUILD_ID?: string;
  readonly VITE_SOURCE_URL?: string;
  readonly VITE_LICENSE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
