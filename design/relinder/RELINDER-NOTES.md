# Relinder — handoff dla Claude Code

Paczka wzorca designu do przeniesienia w repo `couple-adviser` (web/, React+Vite).

## Co tu jest
- **`Relinder — Twarze v1.dc.html`** — finalna wersja ze zdjęciami Ony i On (rekomendowana). Otwórz w przeglądarce (obok leży `support.js` i `uploads/` — działa offline).
- **`Relinder — Dwa Brzegi v1.dc.html`** — ta sama kompozycja, ale z neutralnymi sylwetkami zamiast zdjęć (gdy nie ma zdjęć użytkownika).
- **`RELINDER-NOTES.md`** — pełna specyfikacja: tokeny, decyzje, zachowania (czytaj najpierw).
- **`uploads/imageK.png`** = Ona, **`uploads/imageM.png`** = On.

> To są pliki „.dc.html" (wzorzec wizualny do podglądu/odczytu HTML+CSS). NIE kopiuj ich 1:1 do appki — przełóż na komponenty React, używając tokenów z `web/src/styles.css`.

## Mapowanie na web/src
| Element wzorca | Gdzie w repo |
|---|---|
| Brand lockup (Venn + „Relinder" + podtytuł wersaliki) | `components/ChatScreen.tsx` (header) |
| Klaster 3 awatarów (Doradca · Ona · On) | `ChatScreen.tsx` (header, prawa strona) |
| Awatar (sylwetka dla Doradcy, `<img>` dla Ony/On) | NOWY `components/Avatar.tsx`, używany w MessageBubble/header/status/Composer |
| Kanał „dwa brzegi" + pozycja doradcy wg adresata (lewa/prawa połówka, ikona nad wewn. rogiem dymka) | `MessageBubble.tsx` / `MessageList.tsx` (align wg author/addressee) |
| Puls na osobie oczekiwanej (`@keyframes pulseWait`) | status „czeka na…" + dopisz keyframe do `styles.css` |
| Przełącznik Ona·On·Razem + awatary | `Composer.tsx` (kolejność pigułek + ikony) |
| Wstęga faz | `ChatScreen.tsx` (masz już `PHASE_LABEL`/`PHASE_ORDER`) |

## Tokeny (z styles.css — używaj istniejących)
- Ona/terakota: `#c98a5e`, label `#a86b41`; On/szałwia: `#7d9a6f`, label `#5e7551`; karta `#f7f2ea`, nagłówek `#fdfbf7`.
- Fonty: Newsreader (serif, tytuł/doradca), Hanken Grotesk (sans, UI).

## Sugerowany prompt do Claude Code
> „Przeczytaj `design/relinder/RELINDER-NOTES.md` i otwórz `Relinder — Twarze v1.dc.html` jako wzorzec. Przenieś ten design do `web/src/components`, używając tokenów z `web/src/styles.css`. Zacznij od `Avatar.tsx` (Doradca = sylwetka, Ona/On = zdjęcie wg authora), potem header w `ChatScreen.tsx` (brand lockup + klaster), potem pozycjonowanie doradcy w `MessageBubble.tsx` i puls w statusie. Nie zmieniaj logiki w `useConversation.ts`."

Wrzuć cały ten folder do repo jako `design/relinder/`.
