/**
 * Harness ewaluacyjny modelu — uruchamia realny pipeline produkcyjny (anthropicAdvisor:
 * decide + generateReply, Haiku) na korpusie scenariuszy i ocenia:
 *   (1) KLASYFIKACJĘ reżysera — deterministyczna asercja na decision.type (expect/forbid),
 *   (2) TREŚĆ dymki doradcy — LLM-judge (Opus) wg rubryki.
 * Na końcu: tabela trafności per kategoria + wskaźnik fałszywych pozytywów (KALIBRACJA)
 * + koszt w tokenach/USD (Haiku osobno, Opus-judge osobno), liczony tym samym costUsd
 * co aplikacja. Raport ląduje też w test/eval/last-report.md.
 *
 * NIE jest częścią produkcji ani jej kosztu. Odpalany na żądanie: `npm run test:eval`.
 * Flagi:  --only=NADUZYCIE|KRYZYS|KALIBRACJA|REGRESJA   --no-judge   --id=A1,A3
 *
 * UWAGA: kategoria NADUZYCIE jest CELOWO częściowo czerwona na obecnym kodzie — to
 * baseline luki „neutralność → fałszywa symetria", którą zamknie typ PROTECT.
 */
const fs = require('fs');
const path = require('path');

// ── env (jak server.js: dotenv z relvia.env) ──────────────────────────
const ROOT = path.join(__dirname, '..', '..');
const envText = fs.readFileSync(path.join(ROOT, 'relvia.env'), 'utf8');
for (const line of envText.split('\n')) {
  if (line.trim().startsWith('#')) continue;
  const mt = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (mt) process.env[mt[1]] = mt[2];
}
if (process.env.ADVISOR !== 'anthropic') process.env.ADVISOR = 'anthropic';

const advisor = require(path.join(ROOT, 'srv/advisor/anthropicAdvisor'));
const { costUsd } = require(path.join(ROOT, 'srv/advisor/pricing'));
const { activeModel, decideModel, generateModel } = require(path.join(ROOT, 'srv/advisor/models'));
const { scenarios } = require('./scenarios');
const { judge, JUDGE_MODEL } = require('./judge');
const { judgeLanguage, LANG_JUDGE_MODEL } = require('./language-judge');

// Warstwa GENERACJI może iść innym dostawcą (porównania cross-provider). Decide
// zostaje na Anthropic (advisor.decide). ADVISOR_GENERATE_PROVIDER=openai → GPT-5 itp.
const genProvider = process.env.ADVISOR_GENERATE_PROVIDER || 'anthropic';
const genAdvisor = genProvider === 'openai' ? require('./openai-generate') : advisor;

// ── argumenty ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const onlyCat = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const onlyIds = (args.find((a) => a.startsWith('--id=')) || '').split('=')[1];
const noJudge = args.includes('--no-judge');
const idSet = onlyIds ? new Set(onlyIds.split(',')) : null;

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' };
const tick = (ok) => (ok ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`);

function buildHistory(rows) {
  return rows.map(([author, text, decisionType], i) => ({
    author, text, seq: i, ...(decisionType ? { decisionType } : {}),
  }));
}

async function runReply(decision, history, ctx) {
  let acc = '';
  let usage = {};
  for await (const ev of genAdvisor.generateReply(history, ctx, decision)) {
    if (ev.type === 'delta') acc += ev.text;
    if (ev.type === 'end') { acc = ev.text || acc; usage = ev.usage || {}; }
  }
  return { text: acc, usage };
}

const sumUsage = (a, b) => ({
  inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
  outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
  cacheReadTokens: (a.cacheReadTokens || 0) + (b.cacheReadTokens || 0),
  cacheCreationTokens: (a.cacheCreationTokens || 0) + (b.cacheCreationTokens || 0),
});

(async () => {
  const mDecide = decideModel();
  const mGenerate = generateModel();
  const sameModel = mDecide === mGenerate;
  const modelLabel = sameModel ? mDecide : `decide=${mDecide} · generate=${mGenerate}`;
  const list = scenarios.filter(
    (s) => (!onlyCat || s.cat === onlyCat) && (!idSet || idSet.has(s.id)),
  );

  console.log(`\n${C.bold}EVAL — doradca/reżyser: ${modelLabel} | sędzia: ${noJudge ? '(wyłączony)' : JUDGE_MODEL} | język: ${noJudge ? '(wyłączony)' : LANG_JUDGE_MODEL}${C.reset}`);
  console.log(`${C.dim}scenariuszy: ${list.length} · ${new Date().toISOString()}${C.reset}\n`);

  let decideUsage = {};   // warstwa decyzji (model: decide)
  let generateUsage = {}; // warstwa generacji dymki (model: generate)
  let opusUsage = {};      // sędzia treści + sędzia języka (Opus)
  const langScores = [];   // { id, grammar, naturalness, clarity, issues }
  const results = [];
  const md = [];
  md.push(`# Raport eval — ${new Date().toISOString()}`);
  md.push(`\nModel: \`${modelLabel}\` · sędzia treści: \`${noJudge ? 'wyłączony' : JUDGE_MODEL}\` · sędzia języka: \`${noJudge ? 'wyłączony' : LANG_JUDGE_MODEL}\` · scenariuszy: ${list.length}\n`);

  for (const s of list) {
    const history = buildHistory(s.history);
    const ctx = s.ctx || {};
    let decision;
    try {
      decision = await advisor.decide(history, {}, ctx);
    } catch (e) {
      console.log(`${C.red}[${s.id}] decide ERROR:${C.reset} ${e.message}`);
      results.push({ s, error: e.message });
      continue;
    }
    if (decision.usage) decideUsage = sumUsage(decideUsage, decision.usage);

    const type = decision.type;
    const typeOk = s.expect.includes(type);
    const forbidHit = (s.forbid || []).includes(type);
    const typePass = typeOk && !forbidHit;

    // composerHint (opcjonalna asercja)
    let hintPass = null;
    if (s.composerHint) hintPass = !!decision.composerHint && s.composerHint.test(decision.composerHint);

    // treść dymki + sędzia
    let reply = null;
    let verdicts = [];
    let lang = null;
    if (decision.shouldSpeak && s.rubric.length && !noJudge) {
      const r = await runReply(decision, history, ctx);
      reply = r.text;
      if (r.usage) generateUsage = sumUsage(generateUsage, r.usage);
      try {
        const j = await judge(history, reply, s.rubric);
        verdicts = j.verdicts;
        opusUsage = sumUsage(opusUsage, j.usage);
      } catch (e) {
        verdicts = [{ index: -1, pass: false, reason: `judge error: ${e.message}` }];
      }
      // pogłębiona ocena JĘZYKA (osobny sędzia) — na tej samej, realnej dymce
      try {
        const lj = await judgeLanguage(reply);
        opusUsage = sumUsage(opusUsage, lj.usage);
        lang = { id: s.id, grammar: lj.grammar, naturalness: lj.naturalness, clarity: lj.clarity, issues: lj.issues };
        langScores.push(lang);
      } catch (e) {
        lang = { id: s.id, grammar: 0, naturalness: 0, clarity: 0, issues: [{ quote: '', problem: `lang-judge error: ${e.message}` }] };
        langScores.push(lang);
      }
    } else if (decision.shouldSpeak && s.rubric.length === 0) {
      // typ wymaga mowy, ale brak rubryki (np. REGRESJA) — generujemy bez sędziego dla podglądu/kosztu pełnej tury? pomijamy, by nie palić tokenów
    }

    const rubricPass = verdicts.length ? verdicts.filter((v) => v.pass).length : null;
    const rubricTotal = verdicts.length;

    results.push({ s, type, typePass, forbidHit, hintPass, reply, verdicts, rubricPass, rubricTotal });

    // wydruk
    const bits = [`${tick(typePass)} typ=${C.bold}${type}${C.reset}`];
    if (!typeOk) bits.push(`${C.yellow}(oczek. ${s.expect.join('/')})${C.reset}`);
    if (forbidHit) bits.push(`${C.red}(ZAKAZANY)${C.reset}`);
    if (hintPass !== null) bits.push(`hint:${tick(hintPass)}`);
    if (rubricTotal) bits.push(`rubryka:${rubricPass === rubricTotal ? C.green : C.red}${rubricPass}/${rubricTotal}${C.reset}`);
    console.log(`[${s.id}] ${s.cat.padEnd(10)} ${bits.join('  ')}  ${C.dim}${s.desc}${C.reset}`);
    for (const v of verdicts.filter((v) => !v.pass)) {
      console.log(`        ${C.red}✗${C.reset} ${C.dim}${s.rubric[v.index] || v.reason}${C.reset}\n          → ${v.reason}`);
    }
    if (lang) {
      const lo = Math.min(lang.grammar, lang.naturalness, lang.clarity);
      const col = lo >= 4 ? C.green : lo >= 3 ? C.yellow : C.red;
      console.log(`        ${col}język${C.reset} G${lang.grammar} N${lang.naturalness} Z${lang.clarity}${lang.issues.length ? `  ${C.red}usterki: ${lang.issues.length}${C.reset}` : ''}`);
      for (const it of lang.issues) console.log(`          ${C.dim}· „${it.quote}" — ${it.problem}${C.reset}`);
    }

    // markdown
    md.push(`\n### [${s.id}] ${s.cat} — ${s.desc}`);
    md.push(`- typ: \`${type}\` (oczek. ${s.expect.join('/')}) → **${typePass ? 'PASS' : 'FAIL'}**${forbidHit ? ' ⛔ ZAKAZANY' : ''}`);
    if (hintPass !== null) md.push(`- composerHint: \`${decision.composerHint || '—'}\` → **${hintPass ? 'PASS' : 'FAIL'}**`);
    if (rubricTotal) {
      md.push(`- rubryka: **${rubricPass}/${rubricTotal}**`);
      for (const v of verdicts) md.push(`  - ${v.pass ? '✅' : '❌'} ${s.rubric[v.index] || ''} ${v.pass ? '' : `— _${v.reason}_`}`);
    }
    if (lang) {
      md.push(`- język: **G${lang.grammar} N${lang.naturalness} Z${lang.clarity}**${lang.issues.length ? ` · usterki: ${lang.issues.length}` : ''}`);
      for (const it of lang.issues) md.push(`  - ⚠ „${it.quote}" — _${it.problem}_`);
    }
    if (reply) md.push(`- dymka: > ${reply.replace(/\n+/g, ' ')}`);
  }

  // ── agregaty ───────────────────────────────────────────────────────────────
  const cats = [...new Set(list.map((s) => s.cat))];
  console.log(`\n${C.bold}── PODSUMOWANIE ──────────────────────────────${C.reset}`);
  md.push(`\n## Podsumowanie\n`);
  md.push(`| Kategoria | typ PASS | rubryka PASS | fałszywe pozytywy |`);
  md.push(`|---|---|---|---|`);
  for (const cat of cats) {
    const rs = results.filter((r) => r.s.cat === cat && !r.error);
    const typePass = rs.filter((r) => r.typePass).length;
    const rubricScored = rs.filter((r) => r.rubricTotal);
    const rubricPass = rubricScored.reduce((a, r) => a + (r.rubricPass === r.rubricTotal ? 1 : 0), 0);
    // fałszywy pozytyw = w KALIBRACJI typ wpadł w forbid (PROTECT/SAFETY_STOP)
    const fp = rs.filter((r) => r.forbidHit).length;
    const rubricStr = rubricScored.length ? `${rubricPass}/${rubricScored.length}` : '—';
    console.log(`${cat.padEnd(11)} typ ${typePass}/${rs.length}   rubryka ${rubricStr}   FP ${fp}`);
    md.push(`| ${cat} | ${typePass}/${rs.length} | ${rubricStr} | ${fp} |`);
  }

  // ── JĘZYK (agregat) ──────────────────────────────────────────────────────────
  if (langScores.length) {
    const avg = (k) => (langScores.reduce((a, r) => a + (r[k] || 0), 0) / langScores.length);
    const g = avg('grammar'), n = avg('naturalness'), z = avg('clarity');
    const overall = (g + n + z) / 3;
    const issues = langScores.reduce((a, r) => a + r.issues.length, 0);
    const belowBar = langScores.filter((r) => Math.min(r.grammar, r.naturalness, r.clarity) < 4).length;
    const col = overall >= 4.5 ? C.green : overall >= 3.8 ? C.yellow : C.red;
    console.log(`\n${C.bold}── JĘZYK (sędzia ${LANG_JUDGE_MODEL}, n=${langScores.length}) ──${C.reset}`);
    console.log(`gramatyka ${g.toFixed(2)} · naturalność ${n.toFixed(2)} · zrozumiałość ${z.toFixed(2)}  →  ${col}średnia ${overall.toFixed(2)}/5${C.reset}`);
    console.log(`dymek poniżej progu (min<4): ${belowBar}/${langScores.length} · łącznie usterek: ${issues}`);
    md.push(`\n## Jakość języka (sędzia \`${LANG_JUDGE_MODEL}\`, n=${langScores.length})\n`);
    md.push(`| gramatyka | naturalność | zrozumiałość | **średnia** | dymek min<4 | usterek |`);
    md.push(`|---|---|---|---|---|---|`);
    md.push(`| ${g.toFixed(2)} | ${n.toFixed(2)} | ${z.toFixed(2)} | **${overall.toFixed(2)}/5** | ${belowBar}/${langScores.length} | ${issues} |`);
  }

  // ── koszt ────────────────────────────────────────────────────────────────────
  const decideCost = costUsd(decideUsage, mDecide);
  const generateCost = costUsd(generateUsage, mGenerate);
  const appCost = decideCost + generateCost;
  const opusCost = costUsd(opusUsage, JUDGE_MODEL);
  const fmtTok = (u) => `in ${u.inputTokens || 0} / out ${u.outputTokens || 0} / cacheR ${u.cacheReadTokens || 0} / cacheW ${u.cacheCreationTokens || 0}`;
  console.log(`\n${C.bold}── KOSZT ──────────────────────────────────────${C.reset}`);
  console.log(`decide   (${mDecide}): ${fmtTok(decideUsage)}  →  $${decideCost.toFixed(4)}`);
  console.log(`generate (${mGenerate}): ${fmtTok(generateUsage)}  →  $${generateCost.toFixed(4)}`);
  console.log(`${C.bold}aplikacja (decide+generate): $${appCost.toFixed(4)}${C.reset}`);
  console.log(`${C.dim}sędziowie (${JUDGE_MODEL}, treść+język): ${fmtTok(opusUsage)} → $${opusCost.toFixed(4)} [poza kosztem produkcji]${C.reset}\n`);

  md.push(`\n## Koszt\n`);
  md.push(`- decide \`${mDecide}\`: ${fmtTok(decideUsage)} → **$${decideCost.toFixed(4)}**`);
  md.push(`- generate \`${mGenerate}\`: ${fmtTok(generateUsage)} → **$${generateCost.toFixed(4)}**`);
  md.push(`- **aplikacja (decide+generate): $${appCost.toFixed(4)}**`);
  md.push(`- _sędziowie \`${JUDGE_MODEL}\` (treść+język): ${fmtTok(opusUsage)} → $${opusCost.toFixed(4)} — poza kosztem produkcji_`);

  fs.writeFileSync(path.join(__dirname, 'last-report.md'), md.join('\n') + '\n', 'utf8');
  console.log(`${C.dim}Raport: test/eval/last-report.md${C.reset}`);
})().catch((e) => {
  console.error('EVAL BŁĄD:', e);
  process.exit(1);
});
