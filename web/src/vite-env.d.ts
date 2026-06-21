/// <reference types="vite/client" />

// Typy zmiennych środowiskowych Vite (import.meta.env).
// VITE_USE_MOCK=true → klient offline (mock); inaczej realny backend CAP.
// VITE_ADVISOR_MODE_TOGGLE=true → pokaż przełącznik trybu doradcy (Rozmawia/Tylko słucha).
//   Domyślnie ukryty — logika trybu zostaje w kodzie, może wrócić w przyszłości.
interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string;
  readonly VITE_ADVISOR_MODE_TOGGLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
