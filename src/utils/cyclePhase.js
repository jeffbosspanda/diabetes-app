// Menstrual-cycle phase estimate + glucose-impact guidance for female users.
//
// Hormones shift insulin sensitivity across the cycle:
//   • Follicular (after period → ovulation): estrogen rises, insulin sensitivity
//     relatively higher/stable → BG tends steadier, sometimes lower.
//   • Luteal / premenstrual (after ovulation → next period): progesterone rises
//     → insulin RESISTANCE increases → BG tends to run higher; many need a bit
//     more insulin in the days before menstruation.
//   • Menstruation onset: hormones drop sharply → BG often falls → watch hypos.
//
// This is an estimate from the last period date + average cycle length; it never
// auto-changes doses. Any insulin adjustment must be discussed with a clinician.

const DAY = 24 * 60 * 60 * 1000;

export const CYCLE_PHASE_META = {
  menstrual:  { label: '月經期', short: '月經', bgTrend: 'falling', level: 'info', color: '#ef6c8e' },
  follicular: { label: '濾泡期', short: '濾泡', bgTrend: 'stable',  level: 'good', color: '#34c08a' },
  ovulation:  { label: '排卵期', short: '排卵', bgTrend: 'stable',  level: 'info', color: '#f5a623' },
  luteal:     { label: '黃體期（經前）', short: '黃體', bgTrend: 'rising', level: 'warn', color: '#e8604c' },
};

const PHASE_ORDER = ['menstrual', 'follicular', 'ovulation', 'luteal'];

// Pure mapping: which phase a given 0-based day-in-cycle falls in.
export function phaseForDayInCycle(dayInCycle, len) {
  const day = dayInCycle + 1;       // 1-based
  const ovulation = len - 14;       // luteal phase is ~14 days
  if (day <= 5) return 'menstrual';
  if (day < ovulation - 1) return 'follicular';
  if (day <= ovulation + 1) return 'ovulation';
  return 'luteal';
}

function normalizeLen(cycleLength) {
  return Math.max(20, Math.min(40, Math.round(cycleLength) || 28));
}

export function computeCyclePhase(lastPeriodStart, cycleLength = 28, now = Date.now()) {
  if (!lastPeriodStart) return null;
  const start = new Date(lastPeriodStart).getTime();
  if (isNaN(start)) return null;

  const len = normalizeLen(cycleLength);
  let dayInCycle = Math.floor((now - start) / DAY) % len;
  if (dayInCycle < 0) dayInCycle += len;
  const day = dayInCycle + 1;               // 1-based day of cycle
  const ovulation = len - 14;               // luteal phase is ~14 days
  const daysToNextPeriod = (len - dayInCycle) % len;

  const phase = phaseForDayInCycle(dayInCycle, len);
  const meta = CYCLE_PHASE_META[phase];
  const { label, bgTrend, level } = meta;
  let note;
  if (phase === 'menstrual') {
    note = '荷爾蒙下降，血糖常隨之走低，留意低血糖；經痛或活動量改變也會影響血糖。';
  } else if (phase === 'follicular') {
    note = '此階段胰島素敏感度相對較佳，血糖通常較平穩。';
  } else if (phase === 'ovulation') {
    note = '排卵前後荷爾蒙轉變，血糖可能開始出現波動，持續觀察。';
  } else {
    note = `黃體素上升使胰島素阻抗增加，血糖容易偏高${daysToNextPeriod <= 5 ? '；越接近經期越明顯' : ''}。若持續偏高，調整劑量前請先諮詢醫師或衛教師。`;
  }

  return { day, len, phase, label, bgTrend, note, level, daysToNextPeriod };
}

// ── Personalized: how the user's OWN glucose differs by cycle phase ─────────
// Buckets recent readings into the phase they occurred in (modular over the
// estimated cycle), then compares averages so the user can SEE their luteal-vs-
// follicular gap and menstrual-hypo tendency in their own numbers.
export function analyzeCycleGlucoseImpact(glucoseReadings, lastPeriodStart, cycleLength = 28, opts = {}) {
  if (!lastPeriodStart) return { hasData: false };
  const start = new Date(lastPeriodStart).getTime();
  if (isNaN(start)) return { hasData: false };

  const len = normalizeLen(cycleLength);
  const days = opts.days || 120;
  const cutoff = Date.now() - days * DAY;

  const buckets = {};
  for (const k of PHASE_ORDER) buckets[k] = [];

  for (const r of glucoseReadings) {
    const t = new Date(r.timestamp).getTime();
    if (isNaN(t) || t < cutoff) continue;
    let dayInCycle = Math.floor((t - start) / DAY) % len;
    if (dayInCycle < 0) dayInCycle += len;
    const phase = phaseForDayInCycle(dayInCycle, len);
    buckets[phase].push(r.value);
  }

  const MIN_N = 8; // need enough readings in a phase to report it
  const phases = PHASE_ORDER.map(key => {
    const vals = buckets[key];
    const n = vals.length;
    if (!n) return { key, ...CYCLE_PHASE_META[key], n: 0, enough: false };
    const avg = vals.reduce((s, v) => s + v, 0) / n;
    const hypo = vals.filter(v => v < 70).length;
    const high = vals.filter(v => v > 180).length;
    const tir = vals.filter(v => v >= 70 && v <= 180).length;
    return {
      key, ...CYCLE_PHASE_META[key],
      n, enough: n >= MIN_N,
      avg: Math.round(avg),
      hypoPct: Math.round(hypo / n * 100),
      highPct: Math.round(high / n * 100),
      tirPct: Math.round(tir / n * 100),
    };
  });

  const byKey = Object.fromEntries(phases.map(p => [p.key, p]));
  const luteal = byKey.luteal, follicular = byKey.follicular, menstrual = byKey.menstrual;

  const insights = [];
  // 1) Luteal vs follicular average — the headline cycle effect.
  let lutealDelta = null;
  if (luteal.enough && follicular.enough) {
    lutealDelta = luteal.avg - follicular.avg;
    if (lutealDelta >= 8) {
      insights.push({
        level: 'warn',
        text: `你的黃體期（經前）平均血糖 ${luteal.avg} mg/dL，比濾泡期高 ${lutealDelta} mg/dL — 經前胰島素阻抗讓血糖偏高在你身上是看得到的。經前數天可與醫師討論是否微調劑量。`,
      });
    } else if (lutealDelta <= -8) {
      insights.push({
        level: 'info',
        text: `你的黃體期平均血糖 ${luteal.avg} mg/dL，反而比濾泡期低 ${Math.abs(lutealDelta)} mg/dL，與一般趨勢不同；持續記錄以確認你的個人型態。`,
      });
    } else {
      insights.push({
        level: 'good',
        text: `你的黃體期與濾泡期平均血糖差異不大（${luteal.avg} vs ${follicular.avg} mg/dL），目前週期對血糖影響較小，仍建議持續觀察。`,
      });
    }
  }
  // 2) Menstrual hypo tendency.
  if (menstrual.enough && menstrual.hypoPct >= 12) {
    insights.push({
      level: 'info',
      text: `月經期你有 ${menstrual.hypoPct}% 的血糖低於 70 mg/dL，低血糖偏多；經期前後留意補糖、避免劑量過高。`,
    });
  }

  const reported = phases.filter(p => p.enough).length;
  return {
    hasData: reported >= 1,
    enoughForCompare: !!(luteal.enough && follicular.enough),
    phases, byKey, lutealDelta, insights,
    minN: MIN_N,
  };
}
