// KPI coherence harness — reads the REAL LENDER_STAGES array out of src/App.jsx,
// then reproduces the app's exact reducer (open→pipeline+weighted, won→funded,
// lost→dead) on a synthetic dataset and asserts every number ties out.
import fs from 'fs';
const src = fs.readFileSync('src/App.jsx', 'utf8');

// pull the array literal and eval it (our own trusted source; hex colors only)
const m = src.match(/const LENDER_STAGES=\[([\s\S]*?)\n\];/);
if (!m) { console.error('FAIL: could not find LENDER_STAGES'); process.exit(1); }
const STAGES = eval('[' + m[1] + '\n]');
const GROUPS = ['Prospect', 'Processing', 'Closing', 'Funded'];

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : ' FAIL ') + msg); if (!cond) fails++; };

console.log(`\nLoaded ${STAGES.length} stages from src/App.jsx\n`);

// 1) every stage is EXACTLY one of open / won / lost — never two, never none
for (const s of STAGES) {
  const n = (s.open ? 1 : 0) + (s.won ? 1 : 0) + (s.lost ? 1 : 0);
  ok(n === 1, `stage "${s.key}" has exactly one state (open/won/lost) — got ${n}`);
}

// 2) group discipline: Prospect/Processing/Closing are all-open; Funded is all-won; terminals have no group
const groupOf = k => STAGES.find(s => s.key === k)?.group;
ok(STAGES.filter(s => ['Prospect','Processing','Closing'].includes(s.group)).every(s => s.open),
  'all Prospect/Processing/Closing stages are open (pipeline)');
ok(STAGES.filter(s => s.group === 'Funded').every(s => s.won),
  'all Funded stages are won (realized revenue)');
ok(STAGES.filter(s => s.lost).every(s => !s.group),
  'terminal (withdrawn/lost) stages carry no pipeline group');

// 3) probabilities monotonic-ish and in range
ok(STAGES.every(s => s.prob >= 0 && s.prob <= 1), 'every prob is between 0 and 1');
ok(STAGES.filter(s => s.won).every(s => s.prob === 1), 'funded stages have prob 1.0');

// ---- synthetic dataset: 3 leads in every stage, loan amount = 100000 each ----
const leads = [];
STAGES.forEach((s, i) => { for (let n = 0; n < 3; n++) leads.push({ stage: s.key, dealValue: 100000 }); });
const sOf = k => STAGES.find(s => s.key === k) || STAGES[0];

// reproduce the app's reducer EXACTLY
let openCount = 0, openValue = 0, weighted = 0, wonCount = 0, wonValue = 0, lostCount = 0;
for (const l of leads) {
  const s = sOf(l.stage);
  if (s.open) { openCount++; openValue += l.dealValue; weighted += l.dealValue * s.prob; }
  if (s.won) { wonCount++; wonValue += l.dealValue; }
  if (s.lost) lostCount++;
}

// per-group tallies (what the Pipeline Status widget shows)
const g = {}; GROUPS.forEach(x => g[x] = { count: 0, value: 0 });
for (const l of leads) { const s = sOf(l.stage); if (s.group) { g[s.group].count++; g[s.group].value += l.dealValue; } }

console.log('\n-- totals --');
console.log(`  pipeline (open):  ${openCount} loans  $${openValue.toLocaleString()}  (weighted $${Math.round(weighted).toLocaleString()})`);
console.log(`  funded (won):     ${wonCount} loans  $${wonValue.toLocaleString()}`);
console.log(`  dead (lost):      ${lostCount} loans`);
GROUPS.forEach(x => console.log(`  ${x.padEnd(11)} ${g[x].count} loans  $${g[x].value.toLocaleString()}`));

// 4) THE key invariant: widget group sums must equal the KPI tiles
const pipeGroups = g.Prospect.value + g.Processing.value + g.Closing.value;
const pipeGroupCount = g.Prospect.count + g.Processing.count + g.Closing.count;
console.log('\n-- tie-outs --');
ok(pipeGroups === openValue, `Prospect+Processing+Closing $ (${pipeGroups}) == Pipeline Volume $ (${openValue})`);
ok(pipeGroupCount === openCount, `Prospect+Processing+Closing count (${pipeGroupCount}) == open loan count (${openCount})`);
ok(g.Funded.value === wonValue, `Funded group $ (${g.Funded.value}) == Funded Volume $ (${wonValue})`);
ok(g.Funded.count === wonCount, `Funded group count (${g.Funded.count}) == Loans Funded (${wonCount})`);
ok(openCount + wonCount + lostCount === leads.length, `open+funded+dead (${openCount+wonCount+lostCount}) accounts for every lead (${leads.length}) — no double-count, none dropped`);
ok(weighted <= openValue, `weighted ($${Math.round(weighted)}) never exceeds raw pipeline ($${openValue})`);

// 5) commission coherence (per-loan rate default 1.0% for the test)
const rate = 0.01;
let commFunded = 0, commPipeline = 0, commWeighted = 0;
for (const l of leads) { const s = sOf(l.stage); const c = l.dealValue * rate; if (s.won) commFunded += c; else if (s.open) { commPipeline += c; commWeighted += c * s.prob; } }
ok(Math.round(commFunded) === Math.round(wonValue * rate), 'commission earned == funded volume × rate');
ok(commWeighted <= commPipeline, 'weighted pipeline commission never exceeds full-funnel pipeline commission');

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED ✓' : fails + ' CHECK(S) FAILED ✗'}\n`);
process.exit(fails ? 1 : 0);
