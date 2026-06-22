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
const { activeModel } = require(path.join(ROOT, 'srv/advisor/models'));
const { scenarios } = require('./scenarios');
const { judge, JUDGE_MODEL } = require('./judge');

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
  for await (const ev of advisor.generateReply(history, ctx, decision)) {
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
  const model = activeModel();
  const list = scenarios.filter(
    (s) => (!onlyCat || s.cat === onlyCat) && (!idSet || idSet.has(s.id)),
  );

  console.log(`\n${C.bold}EVAL — doradca/reżyser: ${model} | sędzia: ${noJudge ? '(wyłączony)' : JUDGE_MODEL}${C.reset}`);
  console.log(`${C.dim}scenariuszy: ${list.length} · ${new Date().toISOString()}${C.reset}\n`);

  let haikuUsage = {}; // decide + generateReply (model aplikacji)
  let opusUsage = {};  // judge
  const results = [];
  const md = [];
  md.push(`# Raport eval — ${new Date().toISOString()}`);
  md.push(`\nModel doradcy/reżysera: \`${model}\` · sędzia: \`${noJudge ? 'wyłączony' : JUDGE_MODEL}\` · scenariuszy: ${list.length}\n`);

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
    if (decision.usage) haikuUsage = sumUsage(haikuUsage, decision.usage);

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
    if (decision.shouldSpeak && s.rubric.length && !noJudge) {
      const r = await runReply(decision, history, ctx);
      reply = r.text;
      if (r.usage) haikuUsage = sumUsage(haikuUsage, r.usage);
      try {
        const j = await judge(history, reply, s.rubric);
        verdicts = j.verdicts;
        opusUsage = sumUsage(opusUsage, j.usage);
      } catch (e) {
        verdicts = [{ index: -1, pass: false, reason: `judge error: ${e.message}` }];
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

    // markdown
    md.push(`\n### [${s.id}] ${s.cat} — ${s.desc}`);
    md.push(`- typ: \`${type}\` (oczek. ${s.expect.join('/')}) → **${typePass ? 'PASS' : 'FAIL'}**${forbidHit ? ' ⛔ ZAKAZANY' : ''}`);
    if (hintPass !== null) md.push(`- composerHint: \`${decision.composerHint || '—'}\` → **${hintPass ? 'PASS' : 'FAIL'}**`);
    if (rubricTotal) {
      md.push(`- rubryka: **${rubricPass}/${rubricTotal}**`);
      for (const v of verdicts) md.push(`  - ${v.pass ? '✅' : '❌'} ${s.rubric[v.index] || ''} ${v.pass ? '' : `— _${v.reason}_`}`);
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

  // ── koszt ────────────────────────────────────────────────────────────────────
  const haikuCost = costUsd(haikuUsage, model);
  const opusCost = costUsd(opusUsage, JUDGE_MODEL);
  const fmtTok = (u) => `in ${u.inputTokens || 0} / out ${u.outputTokens || 0} / cacheR ${u.cacheReadTokens || 0}`;
  console.log(`\n${C.bold}── KOSZT ──────────────────────────────────────${C.reset}`);
  console.log(`doradca+reżyser (${model}): ${fmtTok(haikuUsage)}  →  $${haikuCost.toFixed(4)}`);
  console.log(`sędzia (${JUDGE_MODEL}):     ${fmtTok(opusUsage)}  →  $${opusCost.toFixed(4)}`);
  console.log(`${C.bold}RAZEM: $${(haikuCost + opusCost).toFixed(4)}${C.reset}\n`);

  md.push(`\n## Koszt\n`);
  md.push(`- doradca+reżyser \`${model}\`: ${fmtTok(haikuUsage)} → **$${haikuCost.toFixed(4)}**`);
  md.push(`- sędzia \`${JUDGE_MODEL}\`: ${fmtTok(opusUsage)} → **$${opusCost.toFixed(4)}**`);
  md.push(`- **RAZEM: $${(haikuCost + opusCost).toFixed(4)}**`);

  fs.writeFileSync(path.join(__dirname, 'last-report.md'), md.join('\n') + '\n', 'utf8');
  console.log(`${C.dim}Raport: test/eval/last-report.md${C.reset}`);
})().catch((e) => {
  console.error('EVAL BŁĄD:', e);
  process.exit(1);
});
