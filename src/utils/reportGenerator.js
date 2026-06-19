import { format, subDays } from 'date-fns';
import {
  calculateTDD, deriveICRandISF, estimateTDDFromWeight,
  analyzeBasalAdequacy, analyzeRapidDosingHistory, analyzeGlycemicEvents,
} from './insulinCalculator';
import { analyzeGlucoseStats } from './glucoseStats';
import { calcDietaryNeeds } from './dietaryAdvisor';

const GENDER = { male: '男', female: '女' };
const fmtV = v => (v == null ? '—' : v);

function statRow(label, value, ref = '') {
  return `<tr><td class="k">${label}</td><td class="v">${value}</td><td class="ref">${ref}</td></tr>`;
}

export function buildReportHTML(state, opts = {}) {
  const days = opts.days || 14;
  const now = new Date();
  const cutoff = subDays(now, days);

  const p = state.profile || {};
  const stats = analyzeGlucoseStats(state.glucoseReadings, state.meals, { days });
  const basal = analyzeBasalAdequacy(state.glucoseReadings, state.insulinLogs);
  const rapid = analyzeRapidDosingHistory(state.meals, state.glucoseReadings, state.insulinLogs);
  const events = analyzeGlycemicEvents(state.glucoseReadings, state.meals, state.insulinLogs, { days });

  // TDD / ICR / ISF
  const tddLogs = calculateTDD(state.insulinLogs);
  const tdd = tddLogs ?? (p.tdd ? parseFloat(p.tdd) : null) ?? estimateTDDFromWeight(p.weight) ?? 40;
  const tddSource = tddLogs ? '注射紀錄計算' : p.tdd ? '手動輸入' : p.weight ? '體重估算' : '預設值';
  const activeICR = state.icr ?? deriveICRandISF(tdd, state.settings.bgUnit).icr;
  const activeISF = state.isf ?? deriveICRandISF(tdd, state.settings.bgUnit).isf;

  // Insulin totals over period
  const periodLogs = state.insulinLogs.filter(l => new Date(l.timestamp) > cutoff);
  const rapidLogs = periodLogs.filter(l => l.brandType === 'rapid');
  const shortLogs = periodLogs.filter(l => l.brandType === 'short');
  const longLogs  = periodLogs.filter(l => l.brandType === 'long');
  const sumU = arr => Math.round(arr.reduce((s, l) => s + (l.units || 0), 0) * 10) / 10;
  const avgU = arr => arr.length ? Math.round(sumU(arr) / arr.length * 10) / 10 : 0;

  // Nutrition
  const needs = calcDietaryNeeds(p);
  const periodMeals = state.meals.filter(m => new Date(m.timestamp) > cutoff);
  const avgCarbs = periodMeals.length ? Math.round(periodMeals.reduce((s, m) => s + (m.carbs || 0), 0) / periodMeals.length) : null;

  const c = stats.counts;

  const eventRows = events.events.slice(0, 10).map(ev => `
    <tr>
      <td>${format(new Date(ev.startT), 'MM/dd HH:mm')}</td>
      <td class="${ev.kind === 'hypo' ? 'low' : 'high'}">${ev.kind === 'hypo' ? '低血糖' : '高血糖'} ${ev.extreme}</td>
      <td>碳水 ${ev.context.carbs}g／餐前胰島素 ${ev.context.rapidUnits}U${ev.context.lastLong ? `／長效 ${ev.context.lastLong.units}U` : ''}</td>
      <td>${ev.causes.map(x => x.label).join('、')}</td>
    </tr>`).join('');

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>DiaGuide 糖尿病管理報告</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif; color: #1a1a1a; margin: 0; padding: 32px 40px; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #4f46e5; color: #4f46e5; }
  .sub { color: #666; font-size: 12px; margin-bottom: 4px; }
  .meta { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1a1a1a; padding-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  td, th { padding: 5px 8px; text-align: left; vertical-align: top; }
  .grid td.k { color: #555; width: 38%; }
  .grid td.v { font-weight: 700; width: 30%; }
  .grid td.ref { color: #888; font-size: 11px; }
  .grid tr:nth-child(even) { background: #f5f5fa; }
  .cards { display: flex; gap: 10px; margin-bottom: 6px; }
  .kpi { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; }
  .kpi .n { font-size: 20px; font-weight: 800; }
  .kpi .l { font-size: 11px; color: #666; }
  table.data { border: 1px solid #ddd; }
  table.data th { background: #eef; font-size: 11px; }
  table.data td { border-top: 1px solid #eee; font-size: 11px; }
  .low { color: #dc2626; font-weight: 700; }
  .high { color: #d97706; font-weight: 700; }
  .note { font-size: 11px; color: #888; margin-top: 4px; }
  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 11px; color: #888; }
  .print-btn { position: fixed; top: 16px; right: 16px; padding: 9px 16px; background: #4f46e5; color: #fff; border: 0; border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  @media print { body { padding: 16px 20px; } h2 { page-break-after: avoid; } table { page-break-inside: avoid; } .print-btn { display: none !important; } }
</style></head><body>

<button class="print-btn" onclick="window.print()">🖨 列印 / 另存 PDF</button>

<div class="meta">
  <div>
    <h1>🩺 DiaGuide 糖尿病管理報告</h1>
    <div class="sub">報告期間：${format(cutoff, 'yyyy/MM/dd')} – ${format(now, 'yyyy/MM/dd')}（${days} 天）</div>
  </div>
  <div class="sub">產生日期：${format(now, 'yyyy/MM/dd HH:mm')}</div>
</div>

<h2>病患基本資料</h2>
<table class="grid">
  ${statRow('姓名', fmtV(p.name))}
  ${statRow('性別 / 年齡', `${GENDER[p.gender] || '—'}　${fmtV(p.age)} 歲`)}
  ${statRow('體重 / 身高', `${fmtV(p.weight)} kg　${fmtV(p.height)} cm`)}
  ${statRow('體脂率 / 肌肉量', `${fmtV(p.bodyFat)}%　${fmtV(p.muscleMass)} kg`)}
  ${statRow('糖尿病類型', fmtV(p.diabetesType || '第一型'))}
</table>

<h2>血糖控制統計</h2>
<div class="cards">
  <div class="kpi"><div class="n">${fmtV(stats.overallAvg)}</div><div class="l">平均血糖 mg/dL</div></div>
  <div class="kpi"><div class="n">${stats.tir}%</div><div class="l">達標率 TIR (70–180)</div></div>
  <div class="kpi"><div class="n">${stats.readingCount}</div><div class="l">血糖讀數筆數</div></div>
</div>
<table class="grid">
  ${statRow('飯前血糖平均', `${fmtV(stats.preMealAvg)} mg/dL`, `n=${stats.preMealN}　目標 80–130`)}
  ${statRow('飯後峰值血糖平均', `${fmtV(stats.postMealPeakAvg)} mg/dL`, `n=${stats.postMealPeakN}　目標 <180`)}
  ${statRow('深夜血糖平均 (00–06)', `${fmtV(stats.lateNightAvg)} mg/dL`, `n=${stats.lateNightN}　目標 80–130`)}
</table>

<h2>低血糖 / 高血糖事件分布</h2>
<table class="data">
  <tr><th></th><th>飯前</th><th>飯後</th><th>其他時段</th><th>小計</th></tr>
  <tr><td class="low">低血糖 (&lt;70)</td><td>${c.lowPre}</td><td>${c.lowPost}</td><td>${c.lowOther}</td><td><b>${stats.lowTotal}</b></td></tr>
  <tr><td class="high">高血糖 (&gt;180)</td><td>${c.highPre}</td><td>${c.highPost}</td><td>${c.highOther}</td><td><b>${stats.highTotal}</b></td></tr>
</table>

<h2>胰島素治療參數</h2>
<table class="grid">
  ${statRow('每日總劑量 TDD', `${tdd.toFixed(1)} U`, tddSource)}
  ${statRow('碳水比 ICR', `1 : ${activeICR}`, `每 ${activeICR}g 碳水需 1U（500÷TDD）`)}
  ${statRow('胰島素敏感度 ISF', `${activeISF} mg/dL/U`, `1U 降 ${activeISF} mg/dL（1700÷TDD）`)}
  ${statRow('速效注射', `${rapidLogs.length} 次／合計 ${sumU(rapidLogs)} U`, `平均 ${avgU(rapidLogs)} U/次`)}
  ${shortLogs.length ? statRow('短效注射', `${shortLogs.length} 次／合計 ${sumU(shortLogs)} U`, `平均 ${avgU(shortLogs)} U/次`) : ''}
  ${statRow('長效注射', `${longLogs.length} 次／合計 ${sumU(longLogs)} U`, `平均 ${avgU(longLogs)} U/次`)}
</table>

<h2>長效（基礎）胰島素評估</h2>
<table class="grid">
  ${statRow('狀態', basal.status === 'insufficient_data' ? '資料不足' : basal.message || '—')}
  ${basal.avgBG ? statRow('夜間/空腹平均血糖', `${basal.avgBG} mg/dL`) : ''}
  ${basal.suggestion ? statRow('系統建議', basal.suggestion) : ''}
</table>

<h2>餐前胰島素行為（速效/短效・餐後血糖配對）</h2>
${rapid.summary ? `<div class="cards">
  <div class="kpi"><div class="n">${rapid.summary.goodCount}</div><div class="l">達標</div></div>
  <div class="kpi"><div class="n" style="color:#d97706">${rapid.summary.highCount}</div><div class="l">餐後高血糖</div></div>
  <div class="kpi"><div class="n" style="color:#dc2626">${rapid.summary.lowCount}</div><div class="l">餐後低血糖</div></div>
</div>
${rapid.recommendations.length ? '<ul>' + rapid.recommendations.map(r => `<li>${r.msg}　→　${r.action}</li>`).join('') + '</ul>' : ''}`
  : '<div class="note">尚無足夠配對資料</div>'}

<h2>近期血糖事件與推測原因</h2>
${eventRows ? `<table class="data">
  <tr><th>時間</th><th>事件</th><th>事件前 5h 脈絡</th><th>可能原因</th></tr>
  ${eventRows}
</table>` : '<div class="note">期間內無低/高血糖事件</div>'}

<h2>營養攝取概況</h2>
<table class="grid">
  ${needs ? statRow('每日熱量目標 TDEE', `${needs.tdee} kcal`, `建議 ${needs.ranges.calories.min}–${needs.ranges.calories.max}`) : ''}
  ${needs ? statRow('每日碳水目標', `${needs.carbsG} g`, `建議 ${needs.ranges.carbs.min}–${needs.ranges.carbs.max}g`) : ''}
  ${statRow('期間平均每餐碳水', avgCarbs != null ? `${avgCarbs} g` : '—', `共 ${periodMeals.length} 餐紀錄`)}
</table>

<div class="foot">
  本報告由 DiaGuide 依使用者輸入與感測器資料自動產生，所有統計僅供臨床參考，不構成醫療診斷。
  劑量調整請由醫師或糖尿病衛教師依完整臨床評估決定。
</div>

</body></html>`;
}

// Print via a hidden same-origin iframe — works inside sandboxed previews
function printViaIframe(html) {
  const old = document.getElementById('diaguide-report-frame');
  if (old) old.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'diaguide-report-frame';
  iframe.setAttribute('style', 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;');
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch { /* ignore */ }
  }, 400);
}

export function openReport(state, opts) {
  const html = buildReportHTML(state, opts);
  // Blob URL is same-origin (blob:http://localhost…) so the preview allows it;
  // about:blank from window.open('') is treated as a non-localhost URL and blocked.
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) printViaIframe(html); // popups blocked → fall back to iframe print
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
