// Punkt wejścia aplikacji React — montuje <App> w #root i ładuje style A4.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// StrictMode (tylko dev) celowo podwójnie uruchamia efekty, by wyłapać błędy.
// Dzięki leniwemu tworzeniu konwersacji nie powoduje to już śmieci w bazie.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
