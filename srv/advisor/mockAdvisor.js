/**
 * Mock warstwy AI — implementuje kontrakt AdvisorService (decide + generateReply).
 * ZERO tokenów, zero sieci. Faza 3 podmieni ten moduł na realny Anthropic
 * za tym samym interfejsem — patrz srv/advisor/advisor.js.
 *
 * Silnik rozmowy: decide() (regułowy) decyduje, CZY i JAK Advisor ma się odezwać;
 * generateReply() generuje dymkę dopiero gdy decision.shouldSpeak === true.
 * Reguły są celowo proste (krok 1) — fazy/liczniki/parking dochodzą w kroku 2.
 */

const { decide, speakerLabel, isCouple } = require('./decisionRules');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- generacja dymki (tylko gdy shouldSpeak) -------------------------------

const SUMMARIZE = {
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

const SAFETY_TEXT =
  'Zatrzymajmy się na moment — to, co słyszę, brzmi poważnie i Wasze bezpieczeństwo jest najważniejsze. Nie zastąpię tu profesjonalnej pomocy. Jeśli ktokolwiek czuje się zagrożony lub w niebezpieczeństwie, rozważcie kontakt z odpowiednimi służbami (112) lub telefonem zaufania. Jestem tu, żeby Wam towarzyszyć, ale w takiej sytuacji ważne jest wsparcie kogoś, kto może realnie pomóc.';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Treść dymki dobrana do typu decyzji. */
function replyText(decision, history, ctx) {
  const couple = history.filter(isCouple);
  const last = couple[couple.length - 1];
  const lastAuthor = last ? last.author : 'TOGETHER';
  const anchor = decision.topic ? ` Wróćmy najpierw do tego, od czego zaczęliśmy: „${decision.topic}”.` : '';

  // dygresja → potwierdź zaparkowanie i wróć do kotwicy
  if (decision.parkAdd) {
    return `Słyszę nowy wątek — zapiszę go na później, żeby nie zginął.${anchor} Domknijmy najpierw to, nad czym pracujemy.`;
  }

  switch (decision.type) {
    case 'SAFETY_STOP':
      return SAFETY_TEXT;
    case 'INTERVENE':
      return (decision.escalationStreak || 0) >= 2
        ? 'Zróbmy krótką przerwę — temperatura rośnie i trudno się teraz nawzajem usłyszeć. Weźcie po oddechu; za chwilę spróbujcie powiedzieć to samo, ale o sobie: „czuję…”, „potrzebuję…”. Nie chcę, żeby padły słowa, których potem będziecie żałować.'
        : 'Słyszę dużo emocji i napięcia. Zanim padnie odpowiedź — zatrzymajmy się na sekundę. Spróbujcie nazwać, co teraz czujecie, bez oceniania drugiej osoby. Jestem tu, żeby pomóc Wam się usłyszeć, a nie zranić.';
    case 'DEEPEN': {
      const who = speakerLabel(lastAuthor, ctx);
      return `Zatrzymajmy się na chwilę przy tym, co mówisz, ${who}. Słyszę w tym coś ważnego. Opowiedz mi o tym trochę więcej — co czujesz najmocniej w takim momencie i czego najbardziej Ci wtedy brakuje?`;
    }
    case 'ASK_OTHER': {
      const name = speakerLabel(decision.nextSpeaker || (lastAuthor === 'HER' ? 'HIM' : 'HER'), ctx);
      const heard = speakerLabel(lastAuthor, ctx);
      return `Dziękuję, ${heard}. Zapisuję, co czujesz — zanim spróbuję to uporządkować, chciałbym usłyszeć też drugą stronę. ${name}, jak Ty widzisz tę sytuację?`;
    }
    case 'CLARIFY':
      return 'Samo zaprzeczenie jeszcze nie pomaga zrozumieć Twojej perspektywy. Napisz proszę konkretnie: z czym dokładnie się nie zgadzasz i jak to wygląda z Twojej strony — choćby jeden przykład.';
    case 'REFRAME':
      return `Zatrzymajmy się na chwilę — mam wrażenie, że krążymy wokół tego samego z dwóch stron.${anchor} Spróbujmy nazwać wprost, o co tak naprawdę chodzi każdemu z Was.`;
    case 'NARROW':
      return 'Utknęliśmy w ogólnikach i wzajemnym zaprzeczaniu. Spróbujmy inaczej: każde z Was niech poda jeden konkretny przykład z ostatniego tygodnia — zamiast oceny całości.';
    case 'CHOOSE':
      return 'Pojawia się kilka wątków naraz i przez to się rozjeżdżamy. Wybierzmy jeden, najważniejszy dla Was teraz — resztę odłożymy na później i wrócimy do niej spokojnie.';
    case 'PROPOSE':
      return 'Mielimy to w kółko, a samo powtarzanie nas nie zbliża. Zamiast tego mały, konkretny krok: spróbujcie umówić się na jedną rzecz do wypróbowania w najbliższym tygodniu.';
    default:
      return pick(SUMMARIZE[lastAuthor] || SUMMARIZE.TOGETHER);
  }
}

function chunkByWord(text) {
  return text.match(/\S+\s*/g) || [text];
}

module.exports = {
  decide(history, state, context = {}) {
    return Promise.resolve(decide(history, state, context));
  },

  /**
   * @param {Array<{author:string,text:string}>} history pełna historia konwersacji
   * @param {object} context imiona pary
   * @param {import('../../shared/chat-contract').AdvisorDecision} [decision]
   */
  async *generateReply(history, context = {}, decision, _options = {}) {
    const dec = decision || { type: 'SUMMARIZE', kind: 'FULL' };
    const text = replyText(dec, history, context);

    await sleep(450); // doradca "myśli"

    let acc = '';
    for (const chunk of chunkByWord(text)) {
      await sleep(40);
      acc += chunk;
      yield { type: 'delta', text: chunk };
    }
    // mock nie woła API → zero tokenów (realne wartości tylko w trybie anthropic)
    yield {
      type: 'end',
      text: acc,
      finishReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    };
  },
};
