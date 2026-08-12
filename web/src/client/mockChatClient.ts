import type {
  AdvisorDecision,
  ChatClient,
  ChatMessage,
  ChatStreamEvent,
  ConversationState,
  ParkedAction,
  ParkedTopic,
  SendMessageRequest,
  SenderAuthor,
  UiConversationState,
} from '@shared/chat-contract';

/**
 * Mock klienta czatu (Faza 1) — implementuje pełny kontrakt ChatClient
 * i SYMULUJE streaming SSE (chunki słowo po słowie z opóźnieniem).
 *
 * ZERO tokenów, zero sieci. Realny klient HTTP/SSE (Faza 2+) podmieni ten
 * jeden moduł, nie dotykając UI — zwraca identyczne AsyncIterable<ChatStreamEvent>.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

const store = new Map<string, ChatMessage[]>();

function nextSeq(history: ChatMessage[]): number {
  return history.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
}

/** Kanned odpowiedzi doradcy — empatyczne, refleksyjne (jak persona z prototypu). */
const REPLIES: Record<SenderAuthor, string[]> = {
  HER: [
    'Słyszę w tym dużo zmęczenia i samotności w codziennych obowiązkach. To zupełnie naturalne, że potrzebujesz poczuć, że nie dźwigasz tego wszystkiego sama. Zanim zaczniemy szukać rozwiązań, chciałbym dobrze zrozumieć Twoją perspektywę — co w ciągu tygodnia przeciąża Cię najbardziej i w którym momencie czujesz to najmocniej?',
    'Dziękuję, że mówisz o tym tak wprost — to wymaga odwagi. Brzmi to dla mnie jak prośba o bycie zauważoną w tym, ile na sobie trzymasz, a nie tylko o sprawiedliwszy podział zadań. Powiedz mi proszę, gdybyś miała wskazać jedną rzecz, która dałaby Ci poczucie ulgi, co by to było?',
  ],
  HIM: [
    'Słyszę, że bardzo się starasz, a mimo to towarzyszy Ci poczucie, że to wciąż nie wystarcza. To trudne i wyczerpujące uczucie, więc ważne, że je nazywasz na głos. Chciałbym lepiej zrozumieć Twoją stronę — co pomogłoby Ci uwierzyć, że Twój wysiłek naprawdę jest widziany przez drugą stronę?',
    'Dziękuję, że to powiedziałeś — krytyka, której z góry się spodziewasz, potrafi odbierać całą chęć działania. Nie chcę tego upraszczać, chcę to dobrze zrozumieć. Kiedy ostatnio poczułeś, że zrobiłeś coś dobrze i że zostało to zauważone w domu?',
  ],
  TOGETHER: [
    'To, że mówicie do mnie jednym głosem, jest naprawdę mocnym fundamentem i warto się przy tym na chwilę zatrzymać. Pokazuje, że po obu stronach jest ta sama troska o Waszą relację, nawet jeśli na co dzień przykrywają ją napięcia. Spróbujmy nazwać po kolei, czego każde z Was potrzebuje, żeby niedziele wyglądały inaczej — kto chciałby zacząć?',
    'Słyszę Was oboje i bardzo doceniam, że przyszliście z tym razem. Nie musimy niczego rozwiązywać od razu; najpierw chcę zrozumieć, jak ta sama sytuacja wygląda z perspektywy każdego z Was osobno. Co byłoby dla Was pierwszym, drobnym znakiem, że zaczyna iść ku lepszemu?',
  ],
};

function pickReply(author: SenderAuthor): string {
  const pool = REPLIES[author] || REPLIES.TOGETHER;
  return pool[Math.floor(Math.random() * pool.length)];
}

// --- silnik decyzji (lustro srv/advisor/decisionRules.js dla trybu offline) ---

const CRISIS =
  /(zabić|zabij|skrzywdz|przemoc|uderzy|bije|boję się o|chcę zniknąć|nie chcę żyć|odebrać sobie życie|samobój)/i;
const SHORT_NEGATION = /^(nie|tak|nieprawda|bzdura|przesadzasz|wcale nie|właśnie że|kłamiesz)\b[\s.!?]*$/i;
const DIGRESSION =
  /(\ba (tak )?w ogóle\b|przy okazji|swoją drogą|poza tym|\bno i jeszcze\b|innym razem|zmieniając temat|odbiegając|aha i)/i;
// Krok 3: eskalacja — wyzwiska, pogarda, oskarżenia personalne, wulgaryzmy.
const ESCALATION =
  /(idiot|debil|kretyn|głup|beznadziejn|żałosn|egoist|samolub|leniw|kłam|nienawidz|zamknij się|spierdal|pierdol|gówn|chrzań|kurwa|do diabła|olewasz|masz mnie gdzieś|przez ciebie|twoja wina|ty zawsze|ty nigdy)/i;
function isShouting(text: string): boolean {
  const letters = text.replace(/[^a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ]/g, '');
  if (letters.length >= 6 && letters === letters.toUpperCase()) return true;
  if ((text.match(/!/g) || []).length >= 3) return true;
  return false;
}
const isEscalating = (text: string) => ESCALATION.test(text) || isShouting(text);

const NAME: Record<SenderAuthor, string> = { HER: 'Ona', HIM: 'On', TOGETHER: 'Razem' };

// stan reżysera per konwersacja (lustro kolumn Conversations w trybie offline)
const stateStore = new Map<string, ConversationState>();
const freshState = (): ConversationState => ({
  phase: 'OPENING',
  advisorMode: 'LEADING',
  parkedTopics: [],
  turnsSinceProgress: 0,
  escalationStreak: 0,
});
const getStateFor = (id: string): ConversationState => {
  let s = stateStore.get(id);
  if (!s) {
    s = freshState();
    stateStore.set(id, s);
  }
  return s;
};

const isSubstantive = (text: string) => text.trim().length >= 40 && !SHORT_NEGATION.test(text.trim());
const shorten = (text: string, n = 120): string => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
};

function sidesSpoken(history: ChatMessage[]): Set<string> {
  const s = new Set<string>();
  for (const m of history) {
    if (m.author === 'HER') s.add('HER');
    else if (m.author === 'HIM') s.add('HIM');
    else if (m.author === 'TOGETHER') {
      s.add('HER');
      s.add('HIM');
    }
  }
  return s;
}

const hasParaphrased = (history: ChatMessage[]) =>
  history.some((m) => m.author === 'ADVISOR' && m.decisionType === 'SUMMARIZE');

/** Ile razy z rzędu doradca pogłębiał (DEEPEN) z OBECNYM mówcą (od wypowiedzi drugiej strony). */
function deepenCountForCurrent(history: ChatMessage[]): number {
  const couple = history.filter((m) => m.author !== 'ADVISOR');
  const last = couple[couple.length - 1];
  if (!last || last.author === 'TOGETHER') return 0;
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.author === 'ADVISOR') {
      if (m.decisionType === 'DEEPEN') count++;
    } else if (m.author !== last.author) break;
  }
  return count;
}

/** Decyzja reżysera — te same reguły co backend (decisionRules.js).
 *  Wyeksportowane do testu parzystości front↔back (decide-parity.test.ts). */
export function decide(history: ChatMessage[], state: ConversationState): AdvisorDecision {
  const couple = history.filter((m) => m.author !== 'ADVISOR');
  const last = couple[couple.length - 1];
  const prev = couple[couple.length - 2];
  const tsp = state.turnsSinceProgress || 0;
  const phase = state.phase || 'OPENING';

  if (!last)
    return { shouldSpeak: false, type: 'WAIT', kind: 'FULL', phase: 'OPENING', uiHint: 'Doradca słucha w milczeniu…', turnsSinceProgress: 0 };

  if (CRISIS.test(last.text))
    return { shouldSpeak: true, type: 'SAFETY_STOP', kind: 'FULL', phase, topic: state.topic, turnsSinceProgress: 0, escalationStreak: 0 };

  // „TYLKO SŁUCHA" (PAUSED) — obrona w głębi: doradca milczy. W praktyce sendMessage
  // w tym trybie w ogóle nie woła decide (krótkie spięcie niżej).
  if (state.advisorMode === 'PAUSED')
    return {
      shouldSpeak: false,
      type: 'WAIT',
      kind: 'FULL',
      phase,
      topic: state.topic,
      turnsSinceProgress: tsp,
      escalationStreak: state.escalationStreak || 0,
      uiHint: 'Doradca przysłuchuje się w tle…',
    };

  const substantive = isSubstantive(last.text);
  const newTsp = substantive ? 0 : tsp + 1;
  const topic = state.topic || (substantive ? shorten(last.text) : undefined);

  // krok 3: eskalacja → krótka moderacja (priorytet poniżej bezpieczeństwa)
  if (isEscalating(last.text)) {
    const newStreak = (state.escalationStreak || 0) + 1;
    return {
      shouldSpeak: true,
      type: 'INTERVENE',
      kind: 'INTERVENTION',
      phase,
      topic,
      escalationStreak: newStreak,
      turnsSinceProgress: newTsp,
      uiHint: 'Doradca łagodzi napięcie…',
    };
  }

  if (topic && DIGRESSION.test(last.text))
    return { shouldSpeak: true, type: 'REFRAME', kind: 'FULL', phase, topic, parkAdd: shorten(last.text), turnsSinceProgress: newTsp, escalationStreak: 0 };

  // POGŁĘBIENIE — zostań przy mówiącej osobie i dopytaj, zanim oddasz głos/parafrazujesz.
  // Gate na treściowości = adaptacyjnie; sufit 2× chroni przed pętlą pytań.
  if (last.author !== 'TOGETHER' && substantive && deepenCountForCurrent(history) < 2) {
    return {
      shouldSpeak: true,
      type: 'DEEPEN',
      kind: 'FULL',
      phase: last.author === 'HER' ? 'PERSPECTIVE_A' : 'PERSPECTIVE_B',
      topic,
      nextSpeaker: last.author as SenderAuthor,
      turnsSinceProgress: 0,
      escalationStreak: 0,
      uiHint: 'Doradca dopytuje…',
    };
  }

  const spoken = sidesSpoken(history);
  if (last.author !== 'TOGETHER' && spoken.size < 2) {
    const nextSpeaker: SenderAuthor = last.author === 'HER' ? 'HIM' : 'HER';
    return {
      shouldSpeak: true,
      type: 'ASK_OTHER',
      kind: 'FULL',
      phase: last.author === 'HER' ? 'PERSPECTIVE_B' : 'PERSPECTIVE_A',
      nextSpeaker,
      topic,
      turnsSinceProgress: newTsp,
      escalationStreak: 0,
      uiHint: `Doradca czeka na perspektywę: ${NAME[nextSpeaker]}`,
    };
  }

  if (!substantive) {
    if (!SHORT_NEGATION.test(last.text.trim()) && prev && prev.author === last.author)
      return { shouldSpeak: false, type: 'WAIT', kind: 'FULL', phase, topic, turnsSinceProgress: newTsp, escalationStreak: 0, uiHint: 'Doradca słucha w milczeniu…' };
    const ladder: AdvisorDecision['type'] =
      newTsp <= 1 ? 'CLARIFY' : newTsp === 2 ? 'REFRAME' : newTsp === 3 ? 'NARROW' : newTsp === 4 ? 'CHOOSE' : 'PROPOSE';
    const ladderPhase = newTsp >= 5 ? 'AGREEMENT' : newTsp >= 2 ? 'CORE' : phase;
    return { shouldSpeak: true, type: ladder, kind: 'FULL', phase: ladderPhase, topic, turnsSinceProgress: newTsp, escalationStreak: 0 };
  }

  return {
    shouldSpeak: true,
    type: 'SUMMARIZE',
    kind: 'FULL',
    phase: hasParaphrased(history) ? 'CORE' : 'PARAPHRASE',
    topic,
    turnsSinceProgress: 0,
    escalationStreak: 0,
  };
}

const SAFETY_TEXT =
  'Zatrzymajmy się na moment — to, co słyszę, brzmi poważnie i Wasze bezpieczeństwo jest najważniejsze. Nie zastąpię tu profesjonalnej pomocy. Jeśli ktokolwiek czuje się zagrożony, rozważcie kontakt z odpowiednimi służbami (112) lub telefonem zaufania.';

const SENDOFF_TEXT =
  'Zostawiam Was z tym we dwoje — porozmawiajcie między sobą, choćby na spokojnie poza aplikacją. Gdy zechcecie, żebym znów się włączył, przełączcie mnie na „rozmawia" i po prostu napiszcie, jak Wam poszło.';

/** Treść dymki dobrana do typu decyzji (lustro mockAdvisor.replyText). */
function replyText(decision: AdvisorDecision, history: ChatMessage[]): string {
  const couple = history.filter((m) => m.author !== 'ADVISOR');
  const last = couple[couple.length - 1];
  const lastAuthor = (last?.author ?? 'TOGETHER') as SenderAuthor;
  const anchor = decision.topic ? ` Wróćmy najpierw do tego, od czego zaczęliśmy: „${decision.topic}”.` : '';

  if (decision.parkAdd)
    return `Słyszę nowy wątek — zapiszę go na później, żeby nie zginął.${anchor} Domknijmy najpierw to, nad czym pracujemy.`;

  switch (decision.type) {
    case 'SAFETY_STOP':
      return SAFETY_TEXT;
    case 'INTERVENE':
      return (decision.escalationStreak || 0) >= 2
        ? 'Zróbmy krótką przerwę — temperatura rośnie i trudno się teraz nawzajem usłyszeć. Weźcie po oddechu; za chwilę spróbujcie powiedzieć to samo, ale o sobie: „czuję…", „potrzebuję…". Nie chcę, żeby padły słowa, których potem będziecie żałować.'
        : 'Słyszę dużo emocji i napięcia. Zanim padnie odpowiedź — zatrzymajmy się na sekundę. Spróbujcie nazwać, co teraz czujecie, bez oceniania drugiej osoby. Jestem tu, żeby pomóc Wam się usłyszeć, a nie zranić.';
    case 'DEEPEN':
      return `Zatrzymajmy się na chwilę przy tym, co mówisz, ${NAME[lastAuthor]}. Słyszę w tym coś ważnego. Opowiedz mi o tym trochę więcej — co czujesz najmocniej w takim momencie i czego najbardziej Ci wtedy brakuje?`;
    case 'ASK_OTHER': {
      const next = decision.nextSpeaker ?? (lastAuthor === 'HER' ? 'HIM' : 'HER');
      return `Dziękuję, ${NAME[lastAuthor]}. Zapisuję, co czujesz — zanim spróbuję to uporządkować, chciałbym usłyszeć też drugą stronę. ${NAME[next]}, jak Ty widzisz tę sytuację?`;
    }
    case 'CLARIFY':
      return 'Samo zaprzeczenie jeszcze nie pomaga zrozumieć Twojej perspektywy. Napisz proszę konkretnie: z czym się nie zgadzasz i jak to wygląda z Twojej strony — choćby jeden przykład.';
    case 'REFRAME':
      return `Zatrzymajmy się na chwilę — mam wrażenie, że krążymy wokół tego samego z dwóch stron.${anchor} Spróbujmy nazwać wprost, o co tak naprawdę chodzi każdemu z Was.`;
    case 'NARROW':
      return 'Utknęliśmy w ogólnikach i wzajemnym zaprzeczaniu. Spróbujmy inaczej: każde z Was niech poda jeden konkretny przykład z ostatniego tygodnia — zamiast oceny całości.';
    case 'CHOOSE':
      return 'Pojawia się kilka wątków naraz i przez to się rozjeżdżamy. Wybierzmy jeden, najważniejszy dla Was teraz — resztę odłożymy na później i wrócimy do niej spokojnie.';
    case 'PROPOSE':
      return 'Mielimy to w kółko, a samo powtarzanie nas nie zbliża. Zamiast tego mały, konkretny krok: spróbujcie umówić się na jedną rzecz do wypróbowania w najbliższym tygodniu.';
    default:
      return pickReply(lastAuthor);
  }
}

/** Tnie tekst na fragmenty (słowo + spacja) do symulacji streamingu. */
function chunkByWord(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

// UWAGA (i18n): mock jest narzędziem DEV (tryb offline bez tokenów) — jego kanned
// odpowiedzi doradcy pozostają po polsku (bazie znaczeniowej). Kontrakt locale
// przyjmuje i honoruje sygnaturowo (patrz ChatClient), ale nie tłumaczy treści.
export const mockChatClient: ChatClient = {
  async startConversation(_title?: string, _locale?) {
    const conversationId = uid();
    store.set(conversationId, []); // start od pustej rozmowy — bez seedowanych wiadomości
    stateStore.set(conversationId, freshState());
    // mock offline nie egzekwuje dostępu — token jest atrapą dla zgodności z kontraktem
    return { conversationId, herName: 'Ona', hisName: 'On', accessToken: uid() };
  },

  async getHistory(conversationId: string) {
    return [...(store.get(conversationId) ?? [])];
  },

  async getState(conversationId: string): Promise<UiConversationState> {
    const s = getStateFor(conversationId);
    return { phase: s.phase, topic: s.topic, advisorMode: s.advisorMode, parkedTopics: s.parkedTopics };
  },

  async resolveParkedTopic(conversationId: string, topicId: string, action: ParkedAction): Promise<void> {
    const s = getStateFor(conversationId);
    const t = s.parkedTopics.find((p) => p.id === topicId);
    if (!t) return;
    if (action === 'PROMOTE') {
      s.topic = t.text;
      t.status = 'RESOLVED';
    } else {
      t.status = action;
    }
    s.parkedTopics = s.parkedTopics.filter((p) => p.status === 'OPEN');
  },

  async setAdvisorMode(conversationId: string, mode, _accessToken?, _locale?): Promise<void> {
    getStateFor(conversationId).advisorMode = mode;
    if (mode === 'PAUSED') {
      const history = store.get(conversationId) ?? [];
      history.push({
        id: uid(),
        conversationId,
        seq: nextSeq(history),
        author: 'ADVISOR',
        text: SENDOFF_TEXT,
        createdAt: now(),
        kind: 'FULL',
      });
      store.set(conversationId, history);
    }
  },

  async *sendMessage(req: SendMessageRequest): AsyncIterable<ChatStreamEvent> {
    const history = store.get(req.conversationId) ?? [];
    const state = getStateFor(req.conversationId);

    // 1. zapis i echo wiadomości pary
    const userMsg: ChatMessage = {
      id: uid(),
      conversationId: req.conversationId,
      seq: nextSeq(history),
      author: req.author,
      text: req.text,
      createdAt: now(),
    };
    history.push(userMsg);
    store.set(req.conversationId, history);
    yield { type: 'message.user', message: userMsg };

    // „TYLKO SŁUCHA" (PAUSED): doradca całkowicie wyłączony — zero decyzji/generacji.
    // Para pisze między sobą; kończymy na samym echu wiadomości. Powrót = przełącznik.
    if (state.advisorMode === 'PAUSED') return;

    // 2. KROK SILNIKA: decyzja reżysera (czy i jak mówić)
    const decision = decide(history, state);

    // persystencja stanu (faza/kotwica/licznik) + ewentualne zaparkowanie dygresji
    const prevPhase = state.phase;
    if (decision.phase) state.phase = decision.phase;
    if (decision.topic) state.topic = decision.topic;
    if (typeof decision.turnsSinceProgress === 'number') state.turnsSinceProgress = decision.turnsSinceProgress;
    if (typeof decision.escalationStreak === 'number') state.escalationStreak = decision.escalationStreak;
    const phaseChanged = decision.phase && decision.phase !== prevPhase;
    if (decision.parkAdd) {
      const parked: ParkedTopic = { id: uid(), text: decision.parkAdd, status: 'OPEN', parkedAtSeq: userMsg.seq };
      state.parkedTopics = [...state.parkedTopics, parked];
    }

    yield {
      type: 'advisor.decision',
      decision: decision.type,
      phase: decision.phase,
      uiHint: decision.uiHint,
      nextSpeaker: decision.nextSpeaker,
    };
    if (phaseChanged) yield { type: 'phase.change', phase: decision.phase, topic: decision.topic };
    if (decision.parkAdd) yield { type: 'parked.update', topics: state.parkedTopics };

    // Advisor MILCZY — analizuje, ale nie dodaje dymki.
    if (!decision.shouldSpeak) {
      yield { type: 'advisor.wait', uiHint: decision.uiHint ?? 'Doradca słucha w milczeniu…' };
      return;
    }

    // 3. doradca "myśli", potem start odpowiedzi (pusty bąbel)
    await sleep(550);
    const advisorMsg: ChatMessage = {
      id: uid(),
      conversationId: req.conversationId,
      seq: nextSeq(history),
      author: 'ADVISOR',
      text: '',
      createdAt: now(),
      kind: decision.kind,
      decisionType: decision.type,
    };
    yield {
      type: 'advisor.start',
      message: {
        id: advisorMsg.id,
        conversationId: advisorMsg.conversationId,
        seq: advisorMsg.seq,
        author: 'ADVISOR',
        createdAt: advisorMsg.createdAt,
      },
    };

    // 4. streaming treści dobranej do decyzji
    let acc = '';
    for (const chunk of chunkByWord(replyText(decision, history))) {
      await sleep(40);
      acc += chunk;
      yield { type: 'advisor.delta', text: chunk };
    }

    // 5. koniec — utrwalenie
    advisorMsg.text = acc;
    history.push(advisorMsg);
    store.set(req.conversationId, history);
    yield { type: 'advisor.end', text: acc, finishReason: 'end_turn', kind: decision.kind };
  },
};
