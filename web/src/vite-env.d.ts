/// <reference types="vite/client" />

// Typy zmiennych środowiskowych Vite (import.meta.env).
// VITE_USE_MOCK=true → klient offline (mock); inaczej realny backend CAP.
// VITE_ADVISOR_MODE_TOGGLE=true → pokaż przełącznik trybu doradcy (Rozmawia/Tylko słucha).
//   Domyślnie ukryty — logika trybu zostaje w kodzie, może wrócić w przyszłości.
// VITE_PHASE_PROGRESS=true → pokaż wskaźnik postępu fazy (Otwarcie → Ustalenia).
//   Domyślnie ukryty — nie chcemy go pokazywać użytkownikom, ale łatwo włączyć do testów.
interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string;
  readonly VITE_ADVISOR_MODE_TOGGLE?: string;
  readonly VITE_PHASE_PROGRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
