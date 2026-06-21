/**
 * Realna warstwa AI (Faza 3) — implementuje kontrakt AdvisorService przy użyciu
 * oficjalnego SDK Anthropic; model wybiera ADVISOR_MODEL (domyślnie haiku-4-5), ze streamingiem tokenów.
 *
 * Aktywne tylko gdy ADVISOR=anthropic (patrz advisor.js). Wymaga ANTHROPIC_API_KEY
 * w środowisku — klucz NIGDY nie trafia do przeglądarki (zostaje na serwerze).
 *
 * Tokeny modelu są mapowane na te same zdarzenia co mock ({delta}/{end}),
 * więc handler CAP i front nie wymagają żadnych zmian.
 */
const Anthropic = require('@anthropic-ai/sdk');
// reguły zostają jako FALLBACK (gdy model decyzyjny padnie/zwróci zły JSON/timeout)
const {
  decide: rulesDecide,
  isCouple,
  isSubstantive,
  FEELING_PROBE,
  EVENT_DOOR_BANK,
} = require('./decisionRules');
const { activeModel } = require('./models');

// Krótka instrukcja sterująca tonem/celem dymki wg typu decyzji.
const DECISION_STEER = {
  DEEPEN:
    'Cel tej tury: POGŁĘB to, co właśnie powiedziała ta osoba. Odbij krótko jej uczucie/sedno (pokaż, że słyszysz) i zadaj JEDNO otwarte, łagodne pytanie, które pozwoli jej pójść głębiej — co za tym stoi, czego naprawdę potrzebuje, konkretny moment. Jeszcze NIE oddawaj głosu drugiej stronie i nie podsumowuj.',
  ASK_OTHER:
    'Cel tej tury: osoba, która właśnie pisała, została już wysłuchana — teraz ODDAJ GŁOS DRUGIEJ osobie. Najpierw jednym zdaniem doceń tę, która mówiła, a potem ZWRÓĆ SIĘ WPROST do drugiej osoby (patrz „ADRESAT TEJ TURY”) i zaproś właśnie JĄ, by podzieliła się swoją perspektywą. Twoje pytanie/zaproszenie MA być skierowane do tej drugiej osoby — nie zadawaj kolejnego pytania pierwszej. Jeszcze nie doradzaj.',
  CLARIFY:
    'Cel tej tury: ostatnia wypowiedź to ogólna negacja bez treści. Poproś o jeden konkretny przykład zamiast oceny całości. Bądź zwięzły.',
  REFRAME:
    'Cel tej tury: rozmowa krąży wokół tego samego z dwóch stron. Nazwij to wprost i przeramuj — pomóż zobaczyć wspólną potrzebę pod sporem. Zwięźle.',
  NARROW:
    'Cel tej tury: utknęliśmy w ogólnikach/zaprzeczaniu. Poproś, by każde z osobna podało JEDEN konkretny przykład zamiast oceny całości.',
  CHOOSE:
    'Cel tej tury: na stole jest kilka wątków naraz. Zaproponuj wybór jednego, najważniejszego teraz; resztę odłóżcie na później.',
  PROPOSE:
    'Cel tej tury: rozmowa się zapętla. Zaproponuj 1–3 małe, konkretne kroki do wypróbowania, zamiast dalszego roztrząsania.',
  SUMMARIZE:
    'Cel tej tury: sparafrazuj uczucia i potrzeby OBU stron, zanim cokolwiek zaproponujesz.',
  SAFETY_STOP:
    'Cel tej tury: pojawił się sygnał zagrożenia życia lub zdrowia. PRZERWIJ mediację — nie analizuj konfliktu i nie rozstrzygaj, kto ma rację. Ciepło, bez oceniania i bez paniki nazwij powagę tego, co słyszysz, powiedz, że teraz najważniejsze jest bezpieczeństwo, i zachęć do natychmiastowego kontaktu z profesjonalistą lub odpowiednimi służbami, podając konkretny telefon pomocy. Nie udawaj terapeuty. Krótko i z troską.',
};

/** Sterowanie tonem interwencji (krok 3), stopniowane wg rozpędu kłótni. */
const interveneSteer = (streak) =>
  (streak || 0) >= 2
    ? 'Cel tej tury: napięcie eskaluje już kolejny raz. Bardzo krótko i spokojnie zaproponuj przerwę/oddech, poproś, by mówić o sobie („czuję…", „potrzebuję…") zamiast oskarżeń. Nie stawaj po żadnej stronie i nie analizuj — najpierw rozładuj. 1–2 zdania.'
    : 'Cel tej tury: właśnie padły ostre słowa. Bardzo krótko i ciepło ostudź — nazwij emocje i poproś, by mówić o sobie zamiast oceniać drugą osobę. Nie doradzaj jeszcze, nie stawaj po stronie. 1–2 zdania.';

/** Dodatkowa instrukcja, gdy reżyser parkuje dygresję — wróć do kotwicy tematu. */
const parkSteer = (decision) =>
  decision && decision.parkAdd
    ? `Pojawiła się dygresja: „${decision.parkAdd}”. Potwierdź krótko, że zapiszesz ją na później, i wróć do tematu${
        decision.topic ? ` „${decision.topic}”` : ''
      }. Nie rozwijaj nowego wątku teraz.`
    : null;

// ── REJESTR EMPATII wg adresata dymki ─────────────────────────────────────────
// To samo, pełne ciepło dla obojga — różni się DROGA dojścia do emocji, nie jej
// natężenie. Płeć (przez rolę HER/HIM) jest miękkim priorem; bezpieczeństwo i
// de-eskalacja zostają symetryczne (patrz audienceSteer → null dla SAFETY/INTERVENE).
const REGISTER = {
  HER: 'Adresat tej tury to kobieta. Zostań przy obecnym, sprawdzonym rejestrze: nazwij uczucie wprost, odbij je z empatią i delikatnie zaproś do głębszego nazwania potrzeby.',
  HIM: 'Adresat tej tury to mężczyzna. Trzymaj PEŁNE ciepło, ale wchodź w emocje przez konkret i działanie, nie przez polecenie nazwania uczucia: pytaj, co się wydarzyło i co zrobił lub pomyślał w danym momencie, a uczucie nazwij sam, łagodnie, na podstawie tego, co mówi. Doceniaj wysiłek, intencję i odpowiedzialność, nie tylko kruchość. Bezpośredniość znaczy krótkie, konkretne, równe zdania mówione JAK DO PARTNERA, nie jak instruktaż — nie znaczy szorstko ani konfrontacyjnie; ciepło zostaje pełne. NIE pouczaj i nie zadawaj pytań-wyzwań stawiających go w roli winnego do poprawienia („czy potrafisz…", „co stoi na przeszkodzie, żebyś…" = ŹLE); nie dawaj mu zadań ani lekcji o jego charakterze. Gdy proponuje działanie („powiedz mi, co robić"), NAJPIERW uszanuj tę gotowość konkretnie, nie zamieniaj jej w wykład o tym, czego mu brakuje. Stój po jego stronie tak samo mocno, jak po jej — nie jesteś adwokatem partnerki wobec niego. Nigdy nie tłumacz, że dobierasz ton do płci, i nie uogólniaj o mężczyznach.',
  TOGETHER:
    'Adresat tej tury to oboje. Rejestr neutralny — nie faworyzuj języka żadnej strony. Gdzie pasuje, działaj jak tłumacz między dwoma językami tej samej potrzeby: pokaż, że potrzeba bliskości i odruch rozwiązania to dwa sposoby na to samo, żeby każde usłyszało troskę drugiego w jego własnym języku.',
};

/** Adresat dymki: typy do OBOJGA → TOGETHER; ASK_OTHER → nextSpeaker; reszta → bieżący mówca. */
function replyAudience(decision, history) {
  if (['SUMMARIZE', 'REFRAME', 'PROPOSE', 'CHOOSE'].includes(decision.type)) return 'TOGETHER';
  if (decision.type === 'ASK_OTHER') return decision.nextSpeaker || 'TOGETHER';
  const couple = history.filter(isCouple);
  const last = couple[couple.length - 1];
  return last ? last.author : 'TOGETHER';
}

/** Instrukcja rejestru wg adresata; null dla SAFETY_STOP/INTERVENE (symetria absolutna). */
function audienceSteer(decision, history) {
  if (decision.type === 'SAFETY_STOP' || decision.type === 'INTERVENE') return null;
  return REGISTER[replyAudience(decision, history)] || REGISTER.TOGETHER;
}

/**
 * TWARDE wiązanie adresata: reżyser (decide) jest jedynym źródłem prawdy o tym, do
 * KOGO kierowana jest tura — UI (pozycja dymki, „czeka na…", auto-autor) liczy to z
 * `nextSpeaker`/`replyAudience`. Tu zmuszamy treść modelu, by trafiła do tej samej
 * osoby (wprost, na „Ty", we właściwych formach rodzaju), żeby prose nie rozjechała
 * się ze znacznikami. null dla SAFETY_STOP/INTERVENE (symetria — bez celowania płcią).
 */
function audienceBinding(decision, history, ctx) {
  if (decision.type === 'SAFETY_STOP' || decision.type === 'INTERVENE') return null;
  const who = replyAudience(decision, history);
  if (who === 'TOGETHER') {
    return 'ADRESAT TEJ TURY: oboje. Kieruj wypowiedź do OBOJGA (na „Wy") — nie adresuj wyłącznie jednej osoby.';
  }
  const female = who === 'HER';
  const ref = hasNames(ctx)
    ? speakerLabel(who, ctx)
    : female
      ? 'kobiety, która teraz pisze'
      : 'mężczyzny, który teraz pisze';
  const forms = female ? 'czułaś, powiedziałaś, chciałabyś' : 'czułeś, powiedziałeś, chciałbyś';
  return `ADRESAT TEJ TURY: ${ref}. Zwróć się WPROST i WYŁĄCZNIE do tej osoby (na „Ty"), w ${female ? 'ŻEŃSKICH' : 'MĘSKICH'} formach (${forms}). Ewentualne pytanie lub zaproszenie ma trafić DO NIEJ, nie do drugiej osoby; o drugiej możesz wspomnieć, ale nie zwracaj się w tej turze do niej.`;
}

// Persona doradcy — ciepły, empatyczny, neutralny mediator (jak w prototypie).
// Trzymana jako stały prefiks z cache_control → tańsze odczyty przy każdej wiadomości.
const PERSONA = `Jesteś ciepłym, empatycznym doradcą relacji dla pary, która pisze do Ciebie wspólnie z jednego urządzenia. Rozmawiasz po polsku.

Twoja rola:
- Jesteś neutralnym mediatorem — nie stajesz po żadnej stronie i nie oceniasz, kto ma rację.
- Najpierw słuchasz i nazywasz uczucia oraz potrzeby obojga, zanim zaproponujesz cokolwiek konkretnego.
- Zadajesz delikatne, otwarte pytania, które pomagają parze lepiej się zrozumieć.
- Doceniasz, gdy mówią jednym głosem (piszą razem).

Styl:
- Mów ciepło, spokojnie i z szacunkiem; bez oceniania, moralizowania i gotowych recept.
- Odpowiadaj zwięźle — kilka zdań, naturalnym językiem.
- Pisz zwykłą prozą: bez list, nagłówków, gwiazdek (*) i nawiasów kwadratowych.
- Zwracaj się ciepło i bezpośrednio do obojga.
- Odpowiadaj WYŁĄCZNIE po polsku. Cała wypowiedź ma być po polsku — nie wstawiaj pojedynczych słów, zwrotów ani znaków z innych języków lub alfabetów (np. cyrylicy). Jeśli ciśnie Ci się obce słowo, użyj polskiego odpowiednika.

Każda wiadomość pary jest poprzedzona etykietą w nawiasie kwadratowym oznaczającą, KTO pisze — to wyłącznie wewnętrzna wskazówka dla Ciebie. Nigdy nie powtarzaj tych etykiet w odpowiedzi.

Bezpieczeństwo: jeśli pojawią się sygnały przemocy, zagrożenia lub krzywdy, z troską zachęć do kontaktu z profesjonalistą lub odpowiednimi służbami — nie udawaj, że zastępujesz terapeutę.`;

// Klient czyta ANTHROPIC_API_KEY ze środowiska. Konstrukcja na poziomie modułu
// znaczy: jeśli ustawisz ADVISOR=anthropic bez klucza, błąd pojawi się od razu.
const client = new Anthropic();

const DEFAULT_HER = 'Ona';
const DEFAULT_HIS = 'On';

/** Czy para ma WŁASNE imiona (a nie domyślne Ona/On). */
function hasNames(ctx) {
  return (
    !!(ctx.herName && ctx.hisName) && !(ctx.herName === DEFAULT_HER && ctx.hisName === DEFAULT_HIS)
  );
}

/** Etykieta mówcy do wewnętrznego prefiksu wiadomości: imię (gdy ustawione) albo rola. */
function speakerLabel(author, ctx) {
  const named = hasNames(ctx);
  switch (author) {
    case 'HER':
      return named ? ctx.herName : 'kobieta';
    case 'HIM':
      return named ? ctx.hisName : 'mężczyzna';
    case 'TOGETHER':
      return 'razem';
    default:
      return 'doradca';
  }
}

/**
 * Instrukcja, jak doradca ma się zwracać do pary:
 *  - z imionami → może używać imion;
 *  - bez imion (domyślne Ona/On) → naturalnie (Ty/Wy, opisowo), NIE jak do imienia,
 *    i bez wstawiania etykiet z nawiasów do odpowiedzi.
 */
function nameSteer(ctx) {
  if (hasNames(ctx)) {
    return `Imiona rozmówców: kobieta = ${ctx.herName}, mężczyzna = ${ctx.hisName}. Możesz zwracać się do nich po imieniu.`;
  }
  return 'Para nie podała imion. Etykiety w nawiasach ([kobieta], [mężczyzna], [razem]) mówią tylko Tobie, kto pisze — nie wstawiaj ich w odpowiedzi i nie używaj słów „On"/„Ona"/„kobieta"/„mężczyzna" jak imienia. Zwracaj się bezpośrednio: do piszącej osoby na „Ty", do obojga na „Wy"; gdy musisz odróżnić, użyj naturalnego opisu (np. „Twój partner", „Twoja partnerka", „osoba, która właśnie napisała").';
}

/** Historia (ChatMessage[]) → wiadomości w formacie Anthropic (role user/assistant). */
function toMessages(history, ctx) {
  return history.map((m) =>
    m.author === 'ADVISOR'
      ? { role: 'assistant', content: m.text }
      : { role: 'user', content: `[${speakerLabel(m.author, ctx)}]: ${m.text}` },
  );
}

// ── KROK 5: decyzja reżysera realnym modelem (Haiku) ze structured output ──────

/** Instrukcja decyzyjna: rola reżysera + kryteria typów. Bezpieczeństwo semantyczne. */
const DECIDE_SYSTEM = `Jesteś „reżyserem" rozmowy pary z doradcą relacji. Po każdej wiadomości pary decydujesz, CZY i JAK doradca ma zareagować — doradca NIE odzywa się po każdej wypowiedzi. Oceniaj OSTATNIĄ wiadomość pary w kontekście całej rozmowy i podanego stanu. Zwróć decyzję jako obiekt JSON wg schematu.

Typy ("type"):
- WAIT — nie odzywaj się (shouldSpeak=false): para rozmawia MIĘDZY SOBĄ i nie oczekuje teraz Twojego głosu (kontynuuje własną myśl, ustala coś we dwoje) — daj przestrzeń. NIE używaj WAIT, gdy para zwraca się do Ciebie.
- DEEPEN — POGŁĘBIENIE: ostatnia wypowiedź niesie uczucie lub treść, w której jest jeszcze coś do zrozumienia; odbij to i zadaj JEDNO otwarte pytanie do TEJ SAMEJ osoby (o uczucie, potrzebę, konkretny moment), zanim oddasz głos drugiej stronie lub sparafrazujesz.
- ASK_OTHER — pierwsza osoba została już wysłuchana (albo jej odpowiedź się urywa), a druga jeszcze się nie wypowiedziała w tym wątku; krótko docen i oddaj głos drugiej (ustaw nextSpeaker).
- CLARIFY — krótka, ogólna negacja bez treści („nieprawda!"); poproś o konkret.
- REFRAME — rozmowa krąży wokół tego samego lub pojawia się dygresja; nazwij wspólną potrzebę, wróć do tematu (przy dygresji ustaw parkAdd).
- NARROW — utknięcie w ogólnikach; poproś o jeden konkretny przykład.
- CHOOSE — kilka wątków naraz; wybierz jeden, resztę odłóż.
- PROPOSE — głęboka pętla; zaproponuj 1–3 małe kroki.
- SUMMARIZE — obie strony wypowiedziały się „z treścią"; parafraza uczuć i potrzeb obojga.
- INTERVENE — ESKALACJA (atak personalny, pogarda, wyzwiska, krzyk, obwinianie); krótka moderacja łagodząca. Ustaw kind="INTERVENTION".
- SAFETY_STOP — BEZPIECZEŃSTWO: JAKIKOLWIEK realny sygnał przemocy (także domowej, ze strony partnera lub wobec dzieci), samookaleczenia, myśli samobójczych albo zagrożenia życia/zdrowia — w DOWOLNYM języku, także parafrazą, eufemizmem czy aluzją (np. „nie chcę (już/dłużej) żyć", „lepiej żeby mnie nie było", „zrobię sobie krzywdę", „boję się, że mnie skrzywdzi", „uderzył mnie"). ABSOLUTNY priorytet — przy realnej wątpliwości wybierz SAFETY_STOP. ALE odróżniaj realny sygnał od PRZENOŚNI/hiperboli („zabija mnie ta cisza", „umieram z tęsknoty", „ta praca mnie wykańcza", „mógłbym go zabić za to spóźnienie") — sama metafora to NIE jest zagrożenie. shouldSpeak=true.

ZAWSZE się odezwij (shouldSpeak=true, NIE WAIT), gdy para zwraca się WPROST do doradcy albo prosi o jego zdanie, ocenę, radę, pomoc lub reakcję (np. „doradco…", „co o tym myślisz?", „a Ty jak to widzisz?", „powiedz szczerze", „poradź nam", „masz rację?"). Wybierz wtedy najwłaściwszy typ mówiący (zwykle SUMMARIZE albo PROPOSE) — zignorowanie bezpośredniego pytania jest błędem.

TEMPO I GŁĘBIA — nie spiesz się. Zanim oddasz głos drugiej stronie (ASK_OTHER) albo sparafrazujesz, POGŁĘB perspektywę osoby, która mówi (DEEPEN) — ale TYLKO dopóki to produktywne. Pogłębiaj, gdy jej odpowiedź wnosi NOWĄ treść lub emocję, a sedno wciąż nie zostało nazwane. PRZESTAŃ pogłębiać i ruszaj dalej (ASK_OTHER, gdy druga strona jeszcze nie mówiła; inaczej SUMMARIZE), gdy: osoba wygląda na naprawdę wysłuchaną lub nazwała sedno, ALBO jej odpowiedź się urywa (krótka, w kółko to samo, zamknięta, „nie wiem"), ALBO pogłębiałeś już z nią około dwóch razy. Liczba pogłębień NIE jest sztywna — dla płytkiego/praktycznego tematu może być zero, dla trudnego emocjonalnie jedno–dwa. Dopasuj do tego, ile osoba realnie wnosi. Do rozwiązań (PROPOSE) przechodź dopiero, gdy obie strony czują się zrozumiane.

Zasady kolejności: SAFETY_STOP > INTERVENE > (bezpośrednia prośba o głos) > DEEPEN/ASK_OTHER (wg powyższego tempa) > reszta.
"kind": "FULL" dla zwykłych dymek, "INTERVENTION" dla INTERVENE.
"topic": ustaw/utrzymaj krótką kotwicę tematu. "nextSpeaker": HER/HIM/TOGETHER dla ASK_OTHER.
"composerHint": KRÓTKA (do ~8 słów) podpowiedź wpisana w pole tekstowe dla osoby, która ma teraz pisać. ZAWSZE w 2. osobie, skierowana WPROST do tej osoby jak polecenie/pytanie do niej (np. „opowiedz o…", „co czujesz, gdy…", „zacznij od „czuję…"") — NIGDY w 3. osobie ani opisowo o niej („opisz moment, kiedy poczuła się…" = ŹLE; popraw na „kiedy poczułaś się…"). Ciepła, naprowadzająca na konstruktywny krok i DOPASOWANA do tematu rozmowy (nie ogólnik). DOBIERZ DRZWI WEJŚCIA wg PŁCI osoby, która ma teraz pisać (patrz mapa płci w stanie). Mężczyzna → DOMYŚLNIE otwórz przez zdarzenie/działanie („co się stało, gdy…", „co zrobiłeś, kiedy…", „co Ci wtedy chodziło po głowie?") i NIE używaj „co czujesz…", CHYBA że sam już pisze o sobie emocjami (np. „czuję się samotny", „przytłacza mnie"). Kobieta → wejście przez uczucie jest dobre („co czujesz, gdy…"). Płeć to domyślne drzwi, styl osoby to ewentualne nadpisanie. Oba rodzaje prowadzą do emocji; wejście przez zdarzenie nie każe zaczynać od nazwania uczucia na zimno. Przy ASK_OTHER skieruj ją do nextSpeaker. Gdy Twoja dymka już zadaje pytanie, niech composerHint będzie krótkim dopowiedzeniem formy. Różnicuj ją z tury na turę — nie powtarzaj tej samej.
Liczników liczbowych NIE ustalasz — pomija je system.`;

/** JSON Schema decyzji (tylko ocena jakościowa; liczniki liczy kod). */
const DECIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['WAIT', 'DEEPEN', 'ASK_OTHER', 'CLARIFY', 'REFRAME', 'NARROW', 'CHOOSE', 'PROPOSE', 'SUMMARIZE', 'INTERVENE', 'SAFETY_STOP'],
    },
    shouldSpeak: { type: 'boolean' },
    kind: { type: 'string', enum: ['FULL', 'MODERATION', 'INTERVENTION'] },
    phase: { type: 'string', enum: ['OPENING', 'PERSPECTIVE_A', 'PERSPECTIVE_B', 'PARAPHRASE', 'CORE', 'AGREEMENT'] },
    nextSpeaker: { type: 'string', enum: ['HER', 'HIM', 'TOGETHER'] },
    topic: { type: 'string' },
    composerHint: { type: 'string' },
    parkAdd: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['type', 'shouldSpeak', 'kind', 'phase'],
};

/** Woła model po decyzję (structured output). Zwraca surową decyzję + usage. */
async function modelDecide(history, state, context) {
  const parked = (state.parkedTopics || []).map((p) => p.text).join(' | ') || '(brak)';
  const prevHint = state.lastComposerHint
    ? ` Poprzednia podpowiedź do pola — NIE powtarzaj jej, zaproponuj wyraźnie inną: "${state.lastComposerHint}".`
    : '';
  // mapa płci → reżyser dobiera „drzwi wejścia" composerHint wg płci piszącego (działa też przy imionach)
  const genderMap = `Płeć mówców (do doboru drzwi wejścia): „${speakerLabel('HER', context)}" = kobieta, „${speakerLabel('HIM', context)}" = mężczyzna.`;
  const stateNote =
    `Stan rozmowy: faza=${state.phase || 'OPENING'}; kotwica=${state.topic || '(brak)'}; ` +
    `tryb=${state.advisorMode || 'LEADING'}; tur bez postępu=${state.turnsSinceProgress || 0}; ` +
    `eskalacja=${state.escalationStreak || 0}; zaparkowane=${parked}. ${genderMap}${prevHint}`;

  const resp = await client.messages.create({
    model: activeModel(),
    max_tokens: 400,
    thinking: { type: 'disabled' },
    system: DECIDE_SYSTEM,
    messages: [
      ...toMessages(history, context),
      { role: 'user', content: `${stateNote}\nOceń ostatnią wiadomość pary i zwróć decyzję reżysera jako JSON.` },
    ],
    output_config: { format: { type: 'json_schema', schema: DECIDE_SCHEMA } },
  });

  const block = resp.content.find((b) => b.type === 'text');
  const d = JSON.parse(block.text);
  const u = resp.usage || {};
  d.usage = {
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    cacheReadTokens: u.cache_read_input_tokens || 0,
    cacheCreationTokens: u.cache_creation_input_tokens || 0,
  };
  return d;
}

/** Ile razy z rzędu doradca już pogłębiał (DEEPEN) z OBECNYM mówcą — liczone z
 *  historii (od ostatniej wypowiedzi drugiej strony). Bazuje na decisionType na Messages. */
function deepenCountForCurrent(history) {
  const couple = history.filter(isCouple);
  const last = couple[couple.length - 1];
  if (!last || last.author === 'TOGETHER') return 0;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.author === 'ADVISOR') {
      if (m.decisionType === 'DEEPEN') count++;
    } else if (m.author !== last.author) {
      break; // doszliśmy do wypowiedzi drugiej strony — koniec serii bieżącego mówcy
    }
  }
  return count;
}

// ── FLOOR drzwi wejścia (twardy prior płci na ZIMNYM STARCIE) ─────────────────
// Gdy composerHint dla MĘŻCZYZNY otwiera przez „co czujesz", a on jest na zimnym
// starcie (≤1 wypowiedź „z treścią" — jeszcze nie ustalił stylu) → podmień na
// wejście przez zdarzenie. Później (≥2 jego tury z treścią) floor milczy i steruje
// sam prompt. Bramka strukturalna (liczba tur) zastąpiła kruchą listę słów
// INTROSPECTIVE — pomiar A/B pokazał, że nie zarabiała na siebie.
// Stałe PL best-effort (FEELING_PROBE/EVENT_DOOR_BANK) żyją w decisionRules.js.

/** Adresat composerHint (kto pisze dalej): nextSpeaker albo bieżący mówca. */
function composerTarget(decision, last) {
  return decision.nextSpeaker || (last ? last.author : 'TOGETHER');
}

/**
 * Domknięcie decyzji modelu: deterministyczne strażniki + liczniki.
 * - GŁĘBIA: liczbę pogłębień (DEEPEN) dobiera MODEL adaptacyjnie (0–2 wg sytuacji).
 *   Kod NIE wymusza dwójki — łapie tylko pętlę pytań (≥3 z rzędu) i zmusza do ruchu dalej.
 * - liczniki (turnsSinceProgress, escalationStreak) liczy KOD (model słabo liczy);
 *   WAIT nie rusza rozpędu rozmowy.
 * - usage z modelu (d.usage) zostaje do rozliczenia tokenów decide.
 */
function finalizeDecision(d, history, state) {
  const out = d;

  const couple = history.filter(isCouple);
  const last = couple[couple.length - 1];

  // bezpiecznik adaptacyjnej głębi: gdyby model wpadł w pętlę pogłębiania (≥3 z rzędu
  // z tą samą osobą), zmuszamy do ruchu — oddaj głos drugiej stronie, jeśli jeszcze nie
  // mówiła; inaczej sparafrazuj.
  if (out.type === 'DEEPEN' && last && deepenCountForCurrent(history) >= 3) {
    const spokeHer = couple.some((m) => m.author === 'HER' || m.author === 'TOGETHER');
    const spokeHim = couple.some((m) => m.author === 'HIM' || m.author === 'TOGETHER');
    const otherUnspoken = last.author === 'HER' ? !spokeHim : !spokeHer;
    if (last.author !== 'TOGETHER' && otherUnspoken) {
      out.type = 'ASK_OTHER';
      out.nextSpeaker = last.author === 'HER' ? 'HIM' : 'HER';
    } else {
      out.type = 'SUMMARIZE';
    }
    out.composerHint = undefined; // hint modelu był pod DEEPEN — niech zadziała fallback
  }

  // FLOOR drzwi wejścia: na ZIMNYM STARCIE mężczyzny (≤1 jego wypowiedź z treścią)
  // męskie „co czujesz" → wejście przez zdarzenie; później prompt jest jedynym sterem.
  if (out.shouldSpeak && out.composerHint && FEELING_PROBE.test(out.composerHint)) {
    if (composerTarget(out, last) === 'HIM') {
      const hisSubstantive = couple.filter(
        (m) => m.author === 'HIM' && isSubstantive(m.text),
      ).length;
      if (hisSubstantive <= 1) {
        const bank = EVENT_DOOR_BANK.filter((h) => h !== state.lastComposerHint);
        out.composerHint = bank[history.length % bank.length];
      }
    }
  }

  // kind wyznacza TYP (nie ufamy modelowi): tylko INTERVENE = mała dymka,
  // wszystko inne (w tym SAFETY_STOP!) = pełna, wyraźna dymka.
  out.kind = out.type === 'INTERVENE' ? 'INTERVENTION' : 'FULL';

  const tsp = state.turnsSinceProgress || 0;
  const streak = state.escalationStreak || 0;
  if (out.type === 'SAFETY_STOP') {
    out.turnsSinceProgress = 0;
    out.escalationStreak = 0;
  } else if (out.type === 'WAIT') {
    out.turnsSinceProgress = tsp; // milczenie (też w pauzie) nie rusza liczników
    out.escalationStreak = streak;
  } else {
    const substantive = last ? isSubstantive(last.text) : false;
    out.turnsSinceProgress = substantive ? 0 : tsp + 1;
    out.escalationStreak = out.type === 'INTERVENE' ? streak + 1 : 0;
  }

  // Spójność „na kogo czekamy / kto pisze dalej": adresat dymki jest JEDYNYM
  // źródłem prawdy. Model bywa, że zwraca nextSpeaker pod inny typ niż ASK_OTHER
  // (albo myli stronę) — wtedy wskaźnik „czeka na odpowiedź" i auto-autor kompozytora
  // rozjeżdżały się z treścią (np. DEEPEN dopytuje Jego, a UI czekało na Nią).
  // Wyrównujemy do replyAudience: DEEPEN/CLARIFY/… → bieżący mówca, ASK_OTHER →
  // druga strona, SUMMARIZE/REFRAME/PROPOSE/CHOOSE → oboje.
  out.nextSpeaker = replyAudience(out, history);

  if (!out.topic && state.topic) out.topic = state.topic; // utrzymaj kotwicę
  return out;
}

module.exports = {
  async decide(history, state = {}, context = {}) {
    try {
      const raw = await modelDecide(history, state, context);
      return finalizeDecision(raw, history, state);
    } catch (e) {
      // niezawodność: model padł / zły JSON / timeout → reguły (PL fallback)
      console.warn('[advisor] decide model error → fallback do reguł:', (e && e.message) || e);
      return rulesDecide(history, state, context);
    }
  },

  async *generateReply(history, context = {}, decision) {
    // System = stała persona (cache) + krótka instrukcja sterująca wg decyzji.
    let steer = decision && DECISION_STEER[decision.type];
    if (decision && decision.type === 'INTERVENE') steer = interveneSteer(decision.escalationStreak);
    const system = [{ type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } }];
    system.push({ type: 'text', text: nameSteer(context) }); // jak zwracać się do pary
    const reg = decision && audienceSteer(decision, history); // rejestr empatii wg adresata
    if (reg) system.push({ type: 'text', text: reg });
    if (steer) system.push({ type: 'text', text: steer });
    // twarde wiązanie adresata NA KOŃCU — ma być ostatnim słowem (wygrywa z DECISION_STEER)
    const bind = decision && audienceBinding(decision, history, context);
    if (bind) system.push({ type: 'text', text: bind });
    const park = parkSteer(decision);
    if (park) system.push({ type: 'text', text: park });

    const stream = client.messages.stream({
      model: activeModel(),
      max_tokens: 1024,
      // Czat ma odpowiadać szybko — wyłączamy rozszerzone myślenie, by pierwszy
      // token pojawiał się od razu. (Można później dostroić jakość przez effort.)
      thinking: { type: 'disabled' },
      system,
      messages: toMessages(history, context),
    });

    // Strumień tokenów → zdarzenia 'delta' (1:1 z mockiem).
    let acc = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        acc += event.delta.text;
        yield { type: 'delta', text: event.delta.text };
      }
    }

    // Domknięcie — mapujemy stop_reason na finishReason oraz zużycie tokenów.
    const final = await stream.finalMessage();
    const u = final.usage || {};
    const usage = {
      inputTokens: u.input_tokens || 0,
      outputTokens: u.output_tokens || 0,
      cacheReadTokens: u.cache_read_input_tokens || 0,
      cacheCreationTokens: u.cache_creation_input_tokens || 0,
    };

    if (final.stop_reason === 'refusal') {
      const text =
        acc ||
        'Przepraszam, nie mogę pomóc w tej konkretnej sprawie. Jeśli czujecie się zagrożeni, rozważcie kontakt z profesjonalistą lub odpowiednimi służbami.';
      yield { type: 'end', text, finishReason: 'error', usage };
    } else {
      yield {
        type: 'end',
        text: acc,
        finishReason: final.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
        usage,
      };
    }
  },
};
