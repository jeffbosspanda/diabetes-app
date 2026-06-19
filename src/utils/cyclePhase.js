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

export function computeCyclePhase(lastPeriodStart, cycleLength = 28, now = Date.now()) {
  if (!lastPeriodStart) return null;
  const start = new Date(lastPeriodStart).getTime();
  if (isNaN(start)) return null;

  const len = Math.max(20, Math.min(40, Math.round(cycleLength) || 28));
  let dayInCycle = Math.floor((now - start) / DAY) % len;
  if (dayInCycle < 0) dayInCycle += len;
  const day = dayInCycle + 1;               // 1-based day of cycle
  const ovulation = len - 14;               // luteal phase is ~14 days
  const daysToNextPeriod = (len - dayInCycle) % len;

  let phase, label, bgTrend, note, level;
  if (day <= 5) {
    phase = 'menstrual';
    label = '月經期';
    bgTrend = 'falling';
    level = 'info';
    note = '荷爾蒙下降，血糖常隨之走低，留意低血糖；經痛或活動量改變也會影響血糖。';
  } else if (day < ovulation - 1) {
    phase = 'follicular';
    label = '濾泡期';
    bgTrend = 'stable';
    level = 'good';
    note = '此階段胰島素敏感度相對較佳，血糖通常較平穩。';
  } else if (day <= ovulation + 1) {
    phase = 'ovulation';
    label = '排卵期';
    bgTrend = 'stable';
    level = 'info';
    note = '排卵前後荷爾蒙轉變，血糖可能開始出現波動，持續觀察。';
  } else {
    phase = 'luteal';
    label = '黃體期（經前）';
    bgTrend = 'rising';
    level = 'warn';
    note = `黃體素上升使胰島素阻抗增加，血糖容易偏高${daysToNextPeriod <= 5 ? '；越接近經期越明顯' : ''}。若持續偏高，調整劑量前請先諮詢醫師或衛教師。`;
  }

  return { day, len, phase, label, bgTrend, note, level, daysToNextPeriod };
}
