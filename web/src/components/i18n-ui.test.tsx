// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatClient, ChatMessage, ChatStreamEvent, Locale } from '@shared/chat-contract';
import { LOCALE_NATIVE_NAMES, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES } from '@shared/locales.mjs';
import { initI18n } from '../i18n';
import { resolveInitialLocale } from '../i18n/locale';
import ChatScreen from './ChatScreen';

/**
 * Testy komponentów + scenariusze „E2E-like" i18n. Repo NIE ma narzędzia E2E
 * (Playwright/Cypress), więc scenariusze przeglądarkowe odtwarzamy na poziomie
 * komponentów w jsdom: stub navigator.languages + localStorage + zamockowany
 * ChatClient (0 sieci, 0 tokenów). „Odświeżenie strony" = odmontowanie i ponowna
 * inicjalizacja z tych samych źródeł (localStorage/navigator) — dokładnie to robi
 * main.tsx na starcie.
 */

// jsdom nie ma scrollIntoView (MessageList woła je przy każdym renderze)
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Stub języków przeglądarki (jsdom pozwala nadpisać przez defineProperty). */
function stubBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: languages[0], configurable: true });
}

/** „Czysta sesja" jak w main.tsx: język z localStorage/navigatora, potem init. */
function freshSession(languages: string[], stored?: Locale) {
  localStorage.clear();
  if (stored) localStorage.setItem(LOCALE_STORAGE_KEY, stored);
  stubBrowserLanguages(languages);
  initI18n(resolveInitialLocale());
}

/** Zamockowany ChatClient — rejestruje requesty (w tym locale), zero opóźnień. */
function makeFakeClient(opts: { failSendWith?: string } = {}) {
  const calls = {
    start: [] as { title?: string; locale?: Locale }[],
    send: [] as { author: string; text: string; locale?: Locale }[],
  };
  let seq = 0;
  const client: ChatClient = {
    async startConversation(title, locale) {
      calls.start.push({ title, locale });
      return { conversationId: 'c-test', herName: 'Ona', hisName: 'On', accessToken: 'tok' };
    },
    async getHistory() {
      return [] as ChatMessage[];
    },
    async *sendMessage(req): AsyncIterable<ChatStreamEvent> {
      calls.send.push({ author: req.author, text: req.text, locale: req.locale });
      if (opts.failSendWith) {
        throw Object.assign(new Error('stub failure'), { code: opts.failSendWith });
      }
      seq += 1;
      yield {
        type: 'message.user',
        message: {
          id: `m${seq}`,
          conversationId: req.conversationId,
          seq,
          author: req.author,
          text: req.text,
          createdAt: new Date().toISOString(),
        },
      };
      yield { type: 'advisor.decision', decision: 'WAIT', phase: 'OPENING' };
      yield { type: 'advisor.wait', uiHint: 'cisza' };
    },
    async getState() {
      return { phase: 'OPENING' as const, advisorMode: 'LEADING' as const, parkedTopics: [] };
    },
    async resolveParkedTopic() {},
    async setAdvisorMode() {},
  };
  return { client, calls };
}

const composerLabel = () => document.querySelector('.author-select-label')?.textContent;
/** Przełącznik języka = natywny <select>; jego nazwa dostępna zmienia się z językiem. */
const langSelect = () =>
  screen.getByRole('combobox', { name: /^(Język|Language|Sprache)$/ }) as HTMLSelectElement;
const chooseLanguage = (locale: Locale) => fireEvent.change(langSelect(), { target: { value: locale } });
const sendVia = async (text: string) => {
  const ta = document.querySelector('textarea.input') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.click(document.querySelector('button.send') as HTMLButtonElement);
  await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
};

describe('pierwsze uruchomienie — język z przeglądarki (czysta sesja)', () => {
  it('de-DE otwiera niemiecki interfejs (+ <html lang>)', () => {
    freshSession(['de-DE']);
    render(<ChatScreen client={makeFakeClient().client} />);
    expect(composerLabel()).toBe('Du schreibst als');
    expect(screen.getByText('Zusammen')).toBeTruthy();
    expect(document.documentElement.lang).toBe('de');
  });

  it('en-US otwiera angielski interfejs', () => {
    freshSession(['en-US']);
    render(<ChatScreen client={makeFakeClient().client} />);
    expect(composerLabel()).toBe('Writing as');
    expect(document.documentElement.lang).toBe('en');
  });

  it('pl-PL otwiera polski interfejs', () => {
    freshSession(['pl-PL']);
    render(<ChatScreen client={makeFakeClient().client} />);
    expect(composerLabel()).toBe('Piszesz jako');
    expect(screen.getByText('Razem')).toBeTruthy();
    expect(document.documentElement.lang).toBe('pl');
  });

  it('fr-FR (nieobsługiwany) prowadzi do polskiego fallbacku', () => {
    freshSession(['fr-FR', 'fr']);
    render(<ChatScreen client={makeFakeClient().client} />);
    expect(composerLabel()).toBe('Piszesz jako');
    expect(document.documentElement.lang).toBe('pl');
  });
});

describe('przełącznik języka', () => {
  it('zmienia język bez przeładowania, aktualizuje <html lang> i zapisuje wybór', async () => {
    freshSession(['pl-PL']);
    render(<ChatScreen client={makeFakeClient().client} />);
    expect(composerLabel()).toBe('Piszesz jako');

    chooseLanguage('en');
    await waitFor(() => expect(composerLabel()).toBe('Writing as'));
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    // placeholder pola też przełączony (imię domyślne = etykieta roli w nowym języku)
    const ta = document.querySelector('textarea.input') as HTMLTextAreaElement;
    expect(ta.placeholder).toBe('Write as She…');
  });

  it('użytkownik zmienia de→en, „odświeża stronę" i nadal widzi angielski (mimo przeglądarki de-DE)', async () => {
    freshSession(['de-DE']);
    const first = render(<ChatScreen client={makeFakeClient().client} />);
    chooseLanguage('en');
    await waitFor(() => expect(composerLabel()).toBe('Writing as'));
    first.unmount();

    // „refresh": nowa inicjalizacja z localStorage + navigatora (jak main.tsx)
    initI18n(resolveInitialLocale());
    render(<ChatScreen client={makeFakeClient().client} />);
    expect(composerLabel()).toBe('Writing as');
    expect(document.documentElement.lang).toBe('en');
  });

  it('to dostępny z klawiatury <select> z pełną listą języków', async () => {
    freshSession(['pl-PL']);
    render(<ChatScreen client={makeFakeClient().client} />);

    const select = langSelect();
    expect(select.value).toBe('pl'); // bieżący język jako wybrana opcja
    // wszystkie obsługiwane języki, w kolejności ze wspólnego źródła prawdy,
    // nazwane w swoim własnym języku (dodanie locale nie wymaga zmiany UI)
    expect([...select.options].map((o) => o.value)).toEqual([...SUPPORTED_LOCALES]);
    expect([...select.options].map((o) => o.textContent)).toEqual(
      SUPPORTED_LOCALES.map((l) => LOCALE_NATIVE_NAMES[l]),
    );
    // każda opcja oznaczona swoim lang (czytnik ekranu wymawia ją poprawnie)
    expect([...select.options].map((o) => o.lang)).toEqual([...SUPPORTED_LOCALES]);

    select.focus();
    expect(document.activeElement).toBe(select);
    await userEvent.selectOptions(select, 'de');
    await waitFor(() => expect(composerLabel()).toBe('Du schreibst als'));
    expect(langSelect().value).toBe('de');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('de');
  });
});

describe('zmiana języka a stan rozmowy', () => {
  it('nie kasuje historii, nie tworzy nowej konwersacji, a NASTĘPNY request niesie nowe locale', async () => {
    freshSession(['pl-PL']);
    const { client, calls } = makeFakeClient();
    render(<ChatScreen client={client} />);

    await sendVia('Pierwsza wiadomość o nas');
    expect(calls.start).toHaveLength(1);
    expect(calls.start[0].locale).toBe('pl'); // start rozmowy przesyła aktualne locale
    expect(calls.send[0].locale).toBe('pl'); // sendMessage też

    chooseLanguage('de');
    await waitFor(() => expect(composerLabel()).toBe('Du schreibst als'));

    // historia rozmowy nietknięta (nie tłumaczona, nie kasowana)
    expect(screen.getByText('Pierwsza wiadomość o nas')).toBeTruthy();
    expect(calls.start).toHaveLength(1); // ta sama konwersacja

    await sendVia('Zweite Nachricht');
    expect(calls.send[1].locale).toBe('de'); // następny request z nowym locale
  });

  it('komunikat błędu przechowywany jako KOD zmienia język przy przełączeniu', async () => {
    freshSession(['pl-PL']);
    const { client } = makeFakeClient({ failSendWith: 'RATE_LIMIT' });
    render(<ChatScreen client={client} />);

    const ta = document.querySelector('textarea.input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'test' } });
    fireEvent.click(document.querySelector('button.send') as HTMLButtonElement);
    await waitFor(() =>
      expect(screen.getByText('Za szybko — daj chwilę przerwy i spróbuj ponownie.')).toBeTruthy(),
    );

    chooseLanguage('en');
    await waitFor(() => expect(screen.getByText('Too fast — give it a moment and try again.')).toBeTruthy());
  });
});

describe('spójność językowa ekranu', () => {
  it.each(['pl', 'en', 'de'] as const)('%s: brak surowych kluczy i18n w renderze', (lng) => {
    freshSession([lng]);
    render(<ChatScreen client={makeFakeClient().client} />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(
      /\b(app|common|header|phases|composer|conversation|advisorStatus|parked|placeholders|safety|legal|errors)\.[A-Za-z]/,
    );
  });

  it('de: główny ekran bez mieszanki statycznych tekstów z polskiego', () => {
    freshSession(['de-DE']);
    render(<ChatScreen client={makeFakeClient().client} />);
    const text = document.body.textContent ?? '';
    for (const pl of ['Piszesz jako', 'Razem', 'Potrzebujesz pomocy?', 'Wybierzcie']) {
      expect(text).not.toContain(pl);
    }
    // niemieckie odpowiedniki obecne (composer + stopka bezpieczeństwa + empty state)
    for (const de of ['Du schreibst als', 'Zusammen', 'Brauchst du Hilfe?']) {
      expect(text).toContain(de);
    }
  });

  it('powitanie doradcy (syntetyczne) przechodzi na nowy język, gdy rozmowa jeszcze nie ruszyła', async () => {
    freshSession(['pl-PL']);
    render(<ChatScreen client={makeFakeClient().client} />);
    // poczekaj aż powitanie w pełni się wystreamuje (~450+480+chunki*40 ms)
    await waitFor(
      () => expect((document.body.textContent ?? '')).toContain('Zacznijcie osobno albo razem.'),
      { timeout: 5000 },
    );
    chooseLanguage('de');
    await waitFor(() =>
      expect((document.body.textContent ?? '')).toContain('Fangt einzeln an oder gemeinsam.'),
    );
    expect(document.body.textContent).not.toContain('Zacznijcie osobno');
  });
});

describe('SafetyFooter — komunikaty bezpieczeństwa w trzech językach', () => {
  it.each([
    ['pl', 'Potrzebujesz pomocy?', 'Niebieska Linia'],
    ['en', 'Need help?', 'Blue Line'],
    ['de', 'Brauchst du Hilfe?', 'Blaue Linie'],
  ] as const)('%s: rozwija pełny komunikat z numerami', async (lng, buttonLabel, marker) => {
    freshSession([lng]);
    render(<ChatScreen client={makeFakeClient().client} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(buttonLabel.replace('?', '\\?')) }));
    await waitFor(() => {
      const note = document.querySelector('.safety-footer-full');
      expect(note?.textContent).toContain('112');
      expect(note?.textContent).toContain('116 123');
      expect(note?.textContent).toContain('800 120 002');
      expect(note?.textContent).toContain(marker);
    });
  });
});
