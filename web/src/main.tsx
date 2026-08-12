// Punkt wejścia aplikacji React — montuje <App> w #root i ładuje style A4.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initI18n } from './i18n';
import './styles.css';

// i18n PRZED renderem (synchronicznie, zasoby inline) — pierwszy paint jest już
// we właściwym języku (zapisany wybór → języki przeglądarki → pl).
initI18n();

// StrictMode (tylko dev) celowo podwójnie uruchamia efekty, by wyłapać błędy.
// Dzięki leniwemu tworzeniu konwersacji nie powoduje to już śmieci w bazie.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
