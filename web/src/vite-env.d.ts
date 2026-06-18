/// <reference types="vite/client" />

// Typy zmiennych środowiskowych Vite (import.meta.env).
// VITE_USE_MOCK=true → klient offline (mock); inaczej realny backend CAP.
interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
