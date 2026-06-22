/**
 * Eval ADRESAT/RODZAJ — strażnik klasy „rozjazd decyzja↔generacja": markery UI mówią
 * jedno (np. ASK_OTHER → Ona), a dymka po męsku pogłębia Jego. Haiku ignorował wiązanie
 * w system[], gdy ostatnia, terse wypowiedź pary ciągnęła w stronę bieżącego mówcy
 * (np. On: „sfrustrowany"). Fix: wiązanie także jako KOŃCOWA wiadomość user (recency).
 *
 * Tu WYMUSZAMY decyzję (omijamy decide), żeby izolować obedience generateReply, i sędzią
 * Opus oceniamy, czy dymka zwraca się do OCZEKIWANEJ osoby we właściwym rodzaju.
 * Kosztuje tokeny → na żądanie: `npm run test:eval:addr`. N powtórzeń (niedeterminizm).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const envText = fs.readFileSync(path.join(ROOT, 'couple-adviser.env'), 'utf8');
for (const line of envText.split('\n')) {
  if (line.trim().startsWith('#')) continue;
  const mt = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (mt) process.env[mt[1]] = mt[2];
}
process.env.ADVISOR = 'anthropic';

const advisor = require(path.join(ROOT, 'srv/advisor/anthropicAdvisor'));
const { costUsd } = require(path.join(ROOT, 'srv/advisor/pricing'));
const { activeModel } = require(path.join(ROOT, 'srv/advisor/models'));
const { judge, JUDGE_MODEL } = require('./judge');

const N = Number((process.argv.find((a) => a.startsWith('--runs=')) || '').split('=')[1]) || 4;
const PASS_THRESHOLD = 0.75; // ≥75% trafień na przypadek = zielony (Haiku ma wariancję)

let seq = 0;
const m = (author, text, decisionType) => ({ author, text, seq: seq++, ...(decisionType && { decisionType }) });

// Każdy przypadek: historia + WYMUSZONA decyzja + kryterium sędziego (do kogo i w jakim rodzaju).
const cases = [
  {
    id: 'ASK_OTHER→HER (ostatni: On terse „sfrustrowany")',
    history: [
      m('HER', 'Mam wrażenie, że w ogóle ze sobą nie rozmawiamy i to mnie boli.'),
      m('ADVISOR', 'Słyszę tęsknotę za bliskością. Co dla Ciebie znaczy ten wspólny czas?', 'DEEPEN'),
      m('HER', 'Że jesteśmy razem naprawdę, nie obok siebie.'),
      m('ADVISOR', 'To ważne. A Ty, jak to widzisz?', 'ASK_OTHER'),
      m('HIM', 'sfrustrowany'),
    ],
    decision: { type: 'ASK_OTHER', shouldSpeak: true, kind: 'FULL', phase: 'PERSPECTIVE_A', nextSpeaker: 'HER', topic: 'brak rozmów' },
    rubric: 'Dymka ZWRACA SIĘ do kobiety (formy żeńskie, np. „czujesz/widzisz") i zaprasza JĄ, by powiedziała, jak ona to widzi. Mężczyznę może docenić 1 zdaniem, ale NIE pogłębia go (NIE pyta jego, co jego frustruje). Adresatem pytania jest kobieta.',
  },
  {
    id: 'ASK_OTHER→HIM (ostatni: Ona terse „zmęczona")',
    history: [
      m('HIM', 'Czuję, że cokolwiek zrobię, i tak jest źle. Haruję, a to nie wystarcza.'),
      m('ADVISOR', 'Słyszę zmęczenie i poczucie, że Twój wysiłek nie jest widziany. Co najbardziej Cię obciąża?', 'DEEPEN'),
      m('HIM', 'To, że nie czuję docenienia.'),
      m('ADVISOR', 'Rozumiem. A Ty, jak to widzisz?', 'ASK_OTHER'),
      m('HER', 'zmęczona'),
    ],
    decision: { type: 'ASK_OTHER', shouldSpeak: true, kind: 'FULL', phase: 'PERSPECTIVE_B', nextSpeaker: 'HIM', topic: 'docenienie' },
    rubric: 'Dymka ZWRACA SIĘ do mężczyzny (formy męskie, np. „czujesz/powiedziałeś") i zaprasza JEGO, by powiedział, jak on to widzi. Kobietę może docenić 1 zdaniem, ale NIE pogłębia jej. Adresatem pytania jest mężczyzna.',
  },
  {
    id: 'DEEPEN→HIM (zostań przy Nim)',
    history: [
      m('HER', 'Czuję, że się oddalamy.'),
      m('ADVISOR', 'A Ty, jak to widzisz?', 'ASK_OTHER'),
      m('HIM', 'Jestem sfrustrowany, bo mówię coś, a ona tego nie słyszy i czuję się sam.'),
    ],
    decision: { type: 'DEEPEN', shouldSpeak: true, kind: 'FULL', phase: 'PERSPECTIVE_B', nextSpeaker: 'HIM', topic: 'bycie słyszanym' },
    rubric: 'Dymka ZWRACA SIĘ do mężczyzny w formach MĘSKICH (np. „czujesz/powiedziałeś/sam”) i pogłębia JEGO perspektywę. NIE oddaje głosu kobiecie. Brak form żeńskich kierowanych do adresata.',
  },
  {
    id: 'DEEPEN→HER (zostań przy Niej)',
    history: [
      m('HIM', 'Mam wrażenie, że ciągle się czepia.'),
      m('ADVISOR', 'A Ty, jak to widzisz?', 'ASK_OTHER'),
      m('HER', 'Czuję się niewidzialna i samotna, jakby moje potrzeby się nie liczyły.'),
    ],
    decision: { type: 'DEEPEN', shouldSpeak: true, kind: 'FULL', phase: 'PERSPECTIVE_A', nextSpeaker: 'HER', topic: 'bycie widzianą' },
    rubric: 'Dymka ZWRACA SIĘ do kobiety w formach ŻEŃSKICH (np. „czujesz/poczułaś/samotna”) i pogłębia JEJ perspektywę. NIE oddaje głosu mężczyźnie. Brak form męskich kierowanych do adresata.',
  },
];

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' };

async function reply(decision, history) {
  let txt = '';
  let usage = {};
  for await (const ev of advisor.generateReply(history, {}, decision)) {
    if (ev.type === 'end') { txt = ev.text; usage = ev.usage || {}; }
  }
  return { txt, usage };
}
const sum = (a, b) => ({
  inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
  outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
  cacheReadTokens: (a.cacheReadTokens || 0) + (b.cacheReadTokens || 0),
  cacheCreationTokens: (a.cacheCreationTokens || 0) + (b.cacheCreationTokens || 0),
});

(async () => {
  const model = activeModel();
  console.log(`\n${C.bold}EVAL ADRESAT/RODZAJ — generacja: ${model} | sędzia: ${JUDGE_MODEL} | N=${N}${C.reset}\n`);
  let haiku = {};
  let opus = {};
  let allOk = true;

  for (const c of cases) {
    let ok = 0;
    const fails = [];
    for (let i = 0; i < N; i++) {
      const r = await reply(c.decision, c.history);
      haiku = sum(haiku, r.usage);
      const j = await judge(c.history, r.txt, [c.rubric]);
      opus = sum(opus, j.usage);
      const pass = j.verdicts[0] && j.verdicts[0].pass;
      if (pass) ok++;
      else fails.push(`${j.verdicts[0] ? j.verdicts[0].reason : '?'} :: ${r.txt.replace(/\n+/g, ' ').slice(0, 120)}`);
    }
    const rate = ok / N;
    const green = rate >= PASS_THRESHOLD;
    if (!green) allOk = false;
    console.log(`${green ? C.green + 'PASS' : C.red + 'FAIL'}${C.reset} [${c.id}] ${ok}/${N}`);
    for (const f of fails) console.log(`   ${C.dim}✗ ${f}${C.reset}`);
  }

  const cost = costUsd(haiku, model) + costUsd(opus, JUDGE_MODEL);
  console.log(`\n${C.bold}KOSZT: $${cost.toFixed(4)}${C.reset} (generacja ${model} + sędzia ${JUDGE_MODEL})`);
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('EVAL ADRESAT BŁĄD:', e); process.exit(1); });
