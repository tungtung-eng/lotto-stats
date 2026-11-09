/* 大樂透統計 App：資料由 tools/fetch.py、tools/analyze.py 產生（GitHub 每週二、五自動跑） */
'use strict';
const $ = s => document.querySelector(s);
const app = $('#app');
const tip = $('#tip');
let D = null, A = null, L = null;     // draws / analysis / live
const st = { range: 100, model: 'vote', cell: null, pick: [], period: null, wn: 10, wm: 'vote' };
try { Object.assign(st, JSON.parse(localStorage.getItem('lotto-st') || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem('lotto-st', JSON.stringify({ range: st.range, model: st.model, pick: st.pick, wn: st.wn, wm: st.wm })); } catch (e) {} };

const fmt = n => n.toLocaleString('zh-TW');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ball = (n, cls = '') => `<span class="ball ${cls}">${String(n).padStart(2, '0')}</span>`;
const balls = (ns, s, opt = {}) => `<div class="balls">${ns.map(n => ball(n, (opt.sm ? 'sm ' : '') + (opt.hit && opt.hit.has(n) ? 'hit' : ''))).join('')}${s ? `<span class="plus">+</span>${ball(s, 'sp ' + (opt.sm ? 'sm ' : '') + (opt.sp ? 'hit' : ''))}` : ''}</div>`;
const roc = p => { const s = String(p); return `${s.slice(0, s.length - 6)}年第${+s.slice(-6)}期`; };
const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
const modelName = id => id === 'random' ? '亂選（對照組）' : (A.models.find(m => m.id === id) || {}).name;

function verdict(r) {
  if (r.p < 0.05) return `<span class="pill warn">看起來比亂選好，但很可能是碰巧</span>`;
  if (r.mean < A.theory.exp_hits) return `<span class="pill ng">比亂選還差一點（差距在運氣範圍內）</span>`;
  return `<span class="pill">跟亂選沒有差別</span>`;
}

// ---------------------------------------------------------------- 提示框（滑過／點一下看數字）
function bindTips(root) {
  root.querySelectorAll('[data-tip]').forEach(el => {
    const show = e => {
      tip.textContent = el.dataset.tip; tip.style.display = 'block';
      const x = (e.touches ? e.touches[0] : e).clientX, y = (e.touches ? e.touches[0] : e).clientY;
      tip.style.left = Math.min(x + 12, innerWidth - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.max(8, y - 40) + 'px';
    };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', () => tip.style.display = 'none');
  });
}
document.addEventListener('scroll', () => tip.style.display = 'none', { passive: true });

// 橫條圖：rows = [{lab, v, tip, b(對照值)}]
function hbars(rows, max, opt = {}) {
  max = max || Math.max(...rows.map(r => Math.max(r.v, r.b || 0))) || 1;
  return `<div class="hb">${rows.map(r => `
    <span class="lab">${r.lab}</span>
    <span class="tr" data-tip="${esc(r.tip || '')}">
      <i class="${r.b != null ? 'a' : ''}" style="width:${(r.v / max * 100).toFixed(1)}%"></i>
      ${r.b != null ? `<i class="b" style="width:${(r.b / max * 100).toFixed(1)}%"></i>` : ''}
    </span>
    <span class="val">${r.val ?? r.v}</span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- 🔮 預測
function vPredict() {
  const last = D[D.length - 1], nx = A.next, bt = A.bt.res;
  const live = liveSummary();
  let h = `<h1>下一期預測</h1>
  <div class="card"><div class="sub">最新一期 ${roc(last.p)}（${last.d}）</div>${balls(last.n, last.s)}</div>
  <div class="note"><b>先看這個：</b>以下號碼都是統計與 AI 模型「真的算出來」的結果。但在過去 ${fmt(bt.vote.n)} 期的回測裡，
  <b>沒有一個模型穩定贏過亂選</b>（詳見「成績」頁）。每注中頭獎的機率都是 ${fmt(A.theory.jackpot)} 分之 1，不會因為用哪個模型而改變。看看就好，請量力而為。</div>
  <h2>${roc(nx.p)}　<span class="sub">預計 ${nx.d} 開獎</span></h2>`;
  for (const m of A.models) {
    const pk = nx.picks[m.id], r = bt[m.id], lv = live[m.id];
    h += `<div class="card">
      <div class="row"><b class="grow">${m.name}</b>${verdict(r)}</div>
      <div style="margin:8px 0">${balls(pk.n, pk.s)}</div>
      <div class="sub">${m.desc}</div>
      <div class="muted" style="margin-top:4px">回測平均每期對中 ${r.mean.toFixed(3)} 個（亂選理論 ${A.theory.exp_hits.toFixed(3)}）${lv ? `｜上線後 ${lv.n} 期平均 ${lv.mean.toFixed(2)} 個` : ''}</div>
      <div class="muted">「+」後面是特別號參考：排第 7 名的號碼</div>
    </div>`;
  }
  h += `<div class="card"><div class="row"><b class="grow">亂選一組（對照用）</b><button class="btn small ghost" id="rnd">再選一次</button></div>
    <div id="rndout" style="margin-top:8px"></div><div class="sub">完全隨機。跟上面的模型比比看，其實機率一模一樣。</div></div>
  <p class="muted">資料更新：${A.updated.replace('T', ' ')}｜每週二、五開獎後自動更新｜資料來源：台灣彩券公開開獎結果</p>`;
  app.innerHTML = h;
  const rnd = () => { const a = [...Array(49)].map((_, i) => i + 1); for (let i = 48; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } $('#rndout').innerHTML = balls(a.slice(0, 6).sort((x, y) => x - y), a[6]); };
  $('#rnd').onclick = rnd; rnd();
}

function liveSummary() {
  const out = {};
  if (!L) return out;
  for (const e of Object.values(L.preds)) {
    if (!e.result) continue;
    for (const [k, r] of Object.entries(e.result)) {
      const o = out[k] || (out[k] = { n: 0, sum: 0, wins: 0, money: 0 });
      o.n++; o.sum += r.hits; if (r.tier != null) o.wins++; o.money += r.money;
    }
  }
  for (const o of Object.values(out)) o.mean = o.sum / o.n;
  return out;
}

// ---------------------------------------------------------------- 📊 統計
function vStats() {
  const R = st.range === 0 ? D : D.slice(-st.range), n = R.length;
  const cnt = Array(50).fill(0), spc = Array(50).fill(0);
  R.forEach(d => { d.n.forEach(v => cnt[v]++); spc[d.s]++; });
  // 遺漏：用全部資料算
  const gap = Array(50).fill(null), maxGap = Array(50).fill(0), lastSeen = Array(50).fill(-1);
  D.forEach((d, t) => d.n.forEach(v => { maxGap[v] = Math.max(maxGap[v], t - lastSeen[v] - 1); lastSeen[v] = t; }));
  for (let v = 1; v <= 49; v++) { gap[v] = D.length - 1 - lastSeen[v]; maxGap[v] = Math.max(maxGap[v], gap[v]); }
  const exp = n * 6 / 49;
  const nums = [...Array(49)].map((_, i) => i + 1);
  const mx = Math.max(...nums.map(v => cnt[v])), mn = Math.min(...nums.map(v => cnt[v]));
  const lvl = v => mx === mn ? 3 : 1 + Math.min(4, Math.floor((cnt[v] - mn) / (mx - mn + 1e-9) * 5));
  const ranges = [[50, '近 50 期'], [100, '近 100 期'], [300, '近 300 期'], [0, '全部']];

  let h = `<h1>號碼統計</h1>
  <div class="tabs">${ranges.map(([v, t]) => `<button class="tab ${st.range === v ? 'on' : ''}" data-range="${v}">${t}</button>`).join('')}</div>
  <p class="sub">${R[0].d} ～ ${R[n - 1].d}，共 ${fmt(n)} 期。完全公平的話，每個號碼平均該出現 ${exp.toFixed(1)} 次。</p>
  <div class="card"><h3>出現次數（顏色越深越常出現，點號碼看細節）</h3>
  <div class="grid">${nums.map(v => { const q = lvl(v); return `<div class="cell ${st.cell === v ? 'sel' : ''}" data-cell="${v}" style="background:var(--q${q});color:${q >= 4 ? '#fff' : 'var(--ink)'}">${v}<small>${cnt[v]}次</small></div>`; }).join('')}</div>
  <div class="legend"><span><i style="background:var(--q1)"></i>最少 ${mn} 次</span><span><i style="background:var(--q5)"></i>最多 ${mx} 次</span></div>
  <div id="celldet" class="sub"></div></div>`;

  const hot = [...nums].sort((a, b) => cnt[b] - cnt[a] || a - b).slice(0, 10);
  const cold = [...nums].sort((a, b) => gap[b] - gap[a] || a - b).slice(0, 10);
  h += `<div class="card"><h3>🔥 熱號（這段期間出現最多）</h3>${hbars(hot.map(v => ({ lab: ball(v, 'sm'), v: cnt[v], val: cnt[v] + ' 次', tip: `${v} 號：${cnt[v]} 次，平均該 ${exp.toFixed(1)} 次` })))}</div>
  <div class="card"><h3>🧊 冷號（目前最久沒開出）</h3>${hbars(cold.map(v => ({ lab: ball(v, 'sm'), v: gap[v], val: gap[v] + ' 期', tip: `${v} 號：已經 ${gap[v]} 期沒開，史上最久 ${maxGap[v]} 期` })))}
  <p class="muted">「冷號該出來了」是常見的直覺，但每期都是重新開，號碼不會記得自己多久沒出現。</p></div>`;

  // 奇偶、大小
  const th = A.fair.odd_th;
  const oddC = Array(7).fill(0), bigC = Array(7).fill(0); let consec = 0;
  const sumBins = {}, tail = Array(10).fill(0);
  R.forEach(d => {
    oddC[d.n.filter(v => v % 2).length]++; bigC[d.n.filter(v => v >= 25).length]++;
    if (d.n.some((v, i) => i && v - d.n[i - 1] === 1)) consec++;
    const s = d.n.reduce((a, b) => a + b, 0), b = Math.floor(s / 25) * 25; sumBins[b] = (sumBins[b] || 0) + 1;
    d.n.forEach(v => tail[v % 10]++);
  });
  const cmp = (arr, lab) => hbars(arr.map((c, k) => ({ lab: lab(k), v: c / n, b: th[k], val: pct(c / n), tip: `${lab(k)}：實際 ${pct(c / n)}（${c} 期），理論 ${pct(th[k])}` })));
  h += `<div class="card"><h3>奇偶比（6 個號碼裡有幾個奇數）</h3>
    <div class="legend"><span><i style="background:var(--main)"></i>實際</span><span><i style="background:var(--s2)"></i>理論值</span></div>
    ${cmp(oddC, k => `${k}奇${6 - k}偶`)}</div>
  <div class="card"><h3>大小比（25 以上算大）</h3>
    <div class="legend"><span><i style="background:var(--main)"></i>實際</span><span><i style="background:var(--s2)"></i>理論值</span></div>
    ${cmp(bigC, k => `${k}大${6 - k}小`)}</div>
  <div class="card"><h3>有連號的期數</h3><p><b style="font-size:24px">${pct(consec / n)}</b>　<span class="sub">理論值 ${pct(A.fair.consec_th)}</span></p>
    <p class="muted">差不多一半的期數會有連號（例如 12、13），這是數學算得出來的正常現象。</p></div>
  <div class="card"><h3>尾數分布</h3>${hbars(tail.map((c, k) => ({ lab: `尾 ${k}`, v: c, val: c + ' 次', tip: `尾數 ${k}：${c} 次（尾 ${k} 有 ${k === 0 ? 4 : 5} 個號碼）` })))}
    <p class="muted">尾 0 只有 10、20、30、40 四個號碼，其他尾數有 5 個，所以尾 0 本來就比較少。</p></div>
  <div class="card"><h3>總和分布（6 個號碼加起來）</h3>${hbars(Object.keys(sumBins).map(Number).sort((a, b) => a - b).map(b => ({ lab: `${b}～${b + 24}`, v: sumBins[b], val: sumBins[b] + ' 期', tip: `總和 ${b}～${b + 24}：${sumBins[b]} 期` })))}
    <p class="muted">總和平均是 150，越接近中間的組合數越多，所以中間最常出現。</p></div>
  <div class="card"><h3>最近 20 期</h3>${D.slice(-20).reverse().map(d => `<div style="margin:6px 0"><div class="muted">${roc(d.p)}　${d.d}</div>${balls(d.n, d.s, { sm: 1 })}</div>`).join('')}</div>`;
  app.innerHTML = h;
  bindTips(app);
  app.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { st.range = +b.dataset.range; save(); vStats(); });
  const det = v => {
    st.cell = v;
    app.querySelectorAll('.cell').forEach(c => c.classList.toggle('sel', +c.dataset.cell === v));
    $('#celldet').innerHTML = `<p><b>${v} 號</b>：這段期間開出 ${cnt[v]} 次（平均該 ${exp.toFixed(1)} 次），當特別號 ${spc[v]} 次；目前已 ${gap[v]} 期沒開，史上最久 ${maxGap[v]} 期沒開。</p>`;
  };
  app.querySelectorAll('[data-cell]').forEach(c => c.onclick = () => det(+c.dataset.cell));
  if (st.cell) det(st.cell);
}

// ---------------------------------------------------------------- 🏁 成績
function vScore() {
  const bt = A.bt.res, th = A.theory, ids = [...A.models.map(m => m.id), 'random'];
  const pAny = 1 - Math.pow(0.95, A.models.length);
  let h = `<h1>模型成績單</h1>
  <p class="sub">回測：從 ${A.bt.from} 到 ${A.bt.to}，共 ${fmt(bt.vote.n)} 期。每期開獎前，只讓模型看「當時已經知道」的資料去選號，再跟真正開出的號碼對。AI 模型每 100 期重新學一次。</p>
  <div class="card scroll"><table>
    <tr><th>模型</th><th>平均對中</th><th>中獎次數</th><th>花費</th><th>拿回</th></tr>
    ${ids.map(k => { const r = bt[k]; return `<tr><td>${modelName(k)}</td><td>${r.mean.toFixed(3)}</td><td>${r.wins}</td><td>${fmt(r.cost)}</td><td>${fmt(r.money)}</td></tr>`; }).join('')}
    <tr><td><b>數學理論值</b></td><td><b>${th.exp_hits.toFixed(3)}</b></td><td>約 ${(bt.vote.n * th.win).toFixed(0)}</td><td></td><td></td></tr>
  </table>
  <p class="muted">每期買一注 50 元。「拿回」用當期真實獎金計算（頭獎、貳獎若沒人中，用當期累積獎金估）。</p></div>
  <div class="card"><h3>平均每期對中幾個</h3>
  ${hbars(ids.map(k => ({ lab: modelName(k).replace(/（.*）/, ''), v: bt[k].mean, val: bt[k].mean.toFixed(3), tip: `${modelName(k)}：${bt[k].mean.toFixed(3)} 個（理論 ${th.exp_hits.toFixed(3)}）` })), 1)}
  <p class="muted">全部擠在 0.7 附近：亂選的理論值是 6×6÷49 ＝ 0.735 個。</p></div>
  <div class="card"><h3>怎麼看「贏亂選」是真的還是碰巧？</h3>
  ${ids.filter(k => k !== 'random').map(k => `<div class="row" style="margin:6px 0"><span class="grow">${modelName(k)}</span>${verdict(bt[k])}</div>`).join('')}
  <details style="margin-top:8px"><summary>白話說明</summary>
  <p class="sub">我們用統計學的「顯著性檢定」：假設模型其實跟亂選一樣，那它考出這種成績或更好的機率（p 值）有多大。p 值小於 5% 才算「可能真的比較好」。</p>
  <p class="sub">但這裡同時考了 ${A.models.length} 個模型，就算全部都跟亂選一樣，至少有一個「看起來」贏的機率也有 ${pct(pAny, 0)}。所以就算出現一個 p 小於 5%，也要看它能不能在下一段時間繼續贏——這就是「上線後真實戰績」的用意。</p>
  <p class="sub">各模型 p 值：${ids.filter(k => k !== 'random').map(k => `${modelName(k)} ${bt[k].p.toFixed(2)}`).join('、')}</p></details></div>`;

  h += `<div class="card"><h3>成績隨時間變化（每 50 期平均）</h3>
    <select id="msel">${A.models.map(m => `<option value="${m.id}" ${st.model === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
    <div class="legend"><span><i style="background:var(--main)"></i>這個模型</span><span><i style="background:var(--ref)"></i>亂選理論 0.735（虛線）</span></div>
    <div id="line"></div><p class="muted">線在虛線上下亂跳、沒有一直待在上面，就表示沒有真的學到規律。</p></div>`;

  // 對中幾個的分布
  const r = bt[st.model] || bt.vote;
  h += `<div class="card"><h3>對中個數分布：<span id="dname">${modelName(st.model)}</span></h3>
    <div class="legend"><span><i style="background:var(--main)"></i>實際</span><span><i style="background:var(--s2)"></i>亂選理論</span></div>
    <div id="dist"></div></div>`;

  // 上線後真實戰績
  const lv = liveSummary(), lp = L ? Object.entries(L.preds).sort((a, b) => b[0] - a[0]) : [];
  h += `<h2>上線後真實戰績</h2><p class="sub">從 App 上線那天起，每一期的預測都在開獎前就存檔、之後不能改，開獎後自動對獎。這是最誠實的考試。</p>`;
  if (Object.keys(lv).length) {
    h += `<div class="card scroll"><table><tr><th>模型</th><th>期數</th><th>平均對中</th><th>中獎</th><th>拿回</th></tr>
    ${A.models.map(m => lv[m.id] ? `<tr><td>${m.name}</td><td>${lv[m.id].n}</td><td>${lv[m.id].mean.toFixed(2)}</td><td>${lv[m.id].wins}</td><td>${fmt(lv[m.id].money)}</td></tr>` : '').join('')}</table></div>`;
  } else h += `<div class="card sub">第一期還沒開獎，開完就會有成績。</div>`;
  for (const [p, e] of lp.slice(0, 10)) {
    const d = D.find(x => x.p === +p);
    h += `<details class="card"><summary>${roc(p)}（${e.date}）${d ? '' : '　尚未開獎'}</summary>
      ${d ? `<div class="muted" style="margin-top:6px">開獎號碼</div>${balls(d.n, d.s, { sm: 1 })}` : ''}
      ${A.models.map(m => { const pk = e.picks[m.id], rs = e.result && e.result[m.id]; return `<div style="margin-top:8px"><div class="muted">${m.name}${rs ? `：對中 ${rs.hits} 個${rs.tier != null ? '，' + A.tier_names[rs.tier] : ''}` : ''}</div>${balls(pk, null, { sm: 1, hit: d ? new Set(d.n) : null })}</div>`; }).join('')}
    </details>`;
  }
  app.innerHTML = h;
  const draw = () => {
    const rr = bt[st.model];
    $('#line').innerHTML = lineChart(rr.roll, th.exp_hits);
    $('#dname').textContent = modelName(st.model);
    $('#dist').innerHTML = hbars(rr.dist.map((c, k) => ({ lab: `中 ${k} 個`, v: c / rr.n, b: th.dist[k], val: `${c} 期`, tip: `對中 ${k} 個：${c} 期（${pct(c / rr.n, 2)}），亂選理論 ${pct(th.dist[k], 2)}` })));
    bindTips(app);
  };
  $('#msel').onchange = e => { st.model = e.target.value; save(); draw(); };
  draw();
}

function lineChart(vals, ref) {
  const W = 360, H = 200, pl = 30, pr = 8, pt = 10, pb = 22;
  const lo = 0.4, hi = 1.1, x = i => pl + i / (vals.length - 1) * (W - pl - pr), y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [0.4, 0.6, 0.8, 1.0];
  const from = A.bt.from.slice(0, 4), to = A.bt.to.slice(0, 4);
  const id = 'lc' + Math.random().toString(36).slice(2, 7);
  setTimeout(() => {
    const svg = document.getElementById(id); if (!svg) return;
    const cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot');
    const mv = e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(vals.length - 1, Math.round((px - pl) / (W - pl - pr) * (vals.length - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(vals[i])); dot.style.display = '';
      const k = A.bt.res.vote.n, start = Math.round(i * 10);
      tip.textContent = `第 ${start + 1}～${start + 50} 期回測：平均對中 ${vals[i].toFixed(2)} 個`;
      tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY - 40) + 'px';
    };
    svg.addEventListener('pointermove', mv); svg.addEventListener('pointerdown', mv);
    svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.style.display = 'none'; dot.style.display = 'none'; });
  });
  return `<svg id="${id}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;touch-action:pan-y">
    ${ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end">${t.toFixed(1)}</text>`).join('')}
    <line x1="${pl}" x2="${W - pr}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--ref)" stroke-width="1.5" stroke-dasharray="5 4"/>
    <polyline points="${pts}" fill="none" stroke="var(--main)" stroke-width="2" stroke-linejoin="round"/>
    <line class="cross" y1="${pt}" y2="${H - pb}" stroke="var(--sub)" stroke-width="1" style="display:none"/>
    <circle class="dot" r="5" fill="var(--main)" stroke="var(--card)" stroke-width="2" style="display:none"/>
    <text x="${pl}" y="${H - 5}">${from}</text><text x="${W - pr}" y="${H - 5}" text-anchor="end">${to}</text>
  </svg>`;
}

// ---------------------------------------------------------------- ⚖️ 檢定
function vFair() {
  const f = A.fair;
  const ok = p => p >= 0.05 ? `<span class="pill ok">✔ 符合公平</span>` : `<span class="pill warn">△ 有一點偏（p＝${p}）</span>`;
  const W = 360, H = 190, pl = 24, pt = 8, pb = 22, bw = (W - pl) / 49, lim = 3.5;
  const y = v => pt + (lim - v) / (2 * lim) * (H - pt - pb);
  let bars = '';
  f.resid.forEach((r, i) => {
    const y0 = y(0), y1 = y(Math.max(-lim, Math.min(lim, r)));
    bars += `<rect x="${(pl + i * bw + 1).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="2"
      fill="${r >= 0 ? 'var(--main)' : 'var(--s2)'}" data-tip="${i + 1} 號：開出 ${f.obs[i]} 次，公平應為 ${f.expected} 次（偏離 ${r > 0 ? '+' : ''}${r} 個標準差）"/>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
    ${[-2, 0, 2].map(t => `<line x1="${pl}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? 'var(--ref)' : 'var(--line)'}" stroke-dasharray="${t ? '5 4' : ''}"/><text x="${pl - 4}" y="${y(t) + 4}" text-anchor="end">${t > 0 ? '+' : ''}${t}</text>`).join('')}
    ${bars}
    ${[1, 10, 20, 30, 40, 49].map(n => `<text x="${pl + (n - 0.5) * bw}" y="${H - 6}" text-anchor="middle">${n}</text>`).join('')}
  </svg>`;
  const cnt = f.resid.filter(r => Math.abs(r) > 2).length;
  app.innerHTML = `<h1>開獎公平性檢定</h1>
  <p class="sub">用全部 ${fmt(f.draws)} 期檢查：開獎機有沒有特別偏愛某些號碼？用的是統計學的「卡方檢定」，p 值大於 5% 就表示「看不出有偏」。</p>
  <div class="card"><div class="row"><b class="grow">一般號 49 個號碼的次數</b>${ok(f.p)}</div><p class="sub">p 值 ${f.p}：非常接近完全公平。</p></div>
  <div class="card"><div class="row"><b class="grow">特別號</b>${ok(f.p_s)}</div>
    <p class="sub">${f.p_s < 0.05 ? `p 值 ${f.p_s}，有一點點偏。但特別號每期只開 1 個、樣本少，而且這頁同時做了好幾項檢定，有一項剛好偏一點是正常的（就像丟很多次硬幣，總會有一段連續正面）。不代表能拿來預測。` : `p 值 ${f.p_s}。`}</p></div>
  <div class="card"><div class="row"><b class="grow">奇偶比</b>${ok(f.p_odd)}</div><div class="row"><b class="grow">大小比</b>${ok(f.p_big)}</div>
    <div class="row"><b class="grow">有連號的比例</b><span class="sub">實際 ${pct(f.consec_ob)}／理論 ${pct(f.consec_th)}</span></div></div>
  <div class="card"><h3>每個號碼偏離公平多少</h3>
    <div class="legend"><span><i style="background:var(--main)"></i>開得比平均多</span><span><i style="background:var(--s2)"></i>開得比平均少</span><span><i style="background:var(--ref)"></i>±2 標準差（虛線）</span></div>
    ${svg}
    <p class="muted">49 個號碼裡有 ${cnt} 個超出虛線。完全公平的情況下，本來就預期大約 2～3 個會超出（約 5%），所以這很正常。點長條看數字。</p></div>
  <div class="card"><h3>結論</h3><p class="sub">開獎結果跟「完全隨機」吻合。這也說明了為什麼「成績」頁裡，不管多厲害的模型都贏不了亂選：本來就沒有規律可以學。</p></div>`;
  bindTips(app);
}

// ---------------------------------------------------------------- 🎫 對獎
function vCheck() {
  const recent = D.slice(-30).reverse();
  if (!st.period || !D.find(d => d.p === st.period)) st.period = recent[0].p;
  const d = D.find(x => x.p === st.period);
  const pk = st.pick;
  let h = `<h1>對獎</h1>
  <div class="card"><h3>點選你的 6 個號碼 <span class="sub">（已選 ${pk.length}/6）</span></h3>
  <div class="grid">${[...Array(49)].map((_, i) => `<div class="cell ${pk.includes(i + 1) ? 'pick' : 'blank'}" data-p="${i + 1}">${i + 1}</div>`).join('')}</div>
  <div class="row" style="margin-top:10px"><button class="btn small ghost" id="clr">清除</button></div></div>
  <div class="card"><div class="row"><span class="grow">對哪一期</span><select id="per">${recent.map(x => `<option value="${x.p}" ${x.p === st.period ? 'selected' : ''}>${roc(x.p)} ${x.d}</option>`).join('')}</select></div>
  <div style="margin-top:8px">${balls(d.n, d.s)}</div><div id="res" style="margin-top:10px"></div></div>
  <div class="card" id="hist"></div>`;
  app.innerHTML = h;
  app.querySelectorAll('[data-p]').forEach(c => c.onclick = () => {
    const v = +c.dataset.p, i = pk.indexOf(v);
    if (i >= 0) pk.splice(i, 1); else if (pk.length < 6) pk.push(v);
    pk.sort((a, b) => a - b); save(); vCheck();
  });
  $('#clr').onclick = () => { st.pick = []; save(); vCheck(); };
  $('#per').onchange = e => { st.period = +e.target.value; vCheck(); };
  if (pk.length < 6) { $('#res').innerHTML = `<p class="sub">選滿 6 個號碼就會自動對獎。</p>`; $('#hist').style.display = 'none'; return; }
  const g = gradeOne(pk, d);
  $('#res').innerHTML = `<p>你的號碼</p>${balls(pk, null, { hit: new Set(d.n) })}
    <p style="margin-top:8px"><b>對中 ${g.h} 個${g.sp ? '＋特別號' : ''}</b>　${g.tr != null ? `<span class="pill ok">🎉 ${A.tier_names[g.tr]}　${fmt(g.m)} 元</span>` : '<span class="pill">沒中</span>'}</p>`;
  // 歷史試算
  const tiers = Array(8).fill(0); let money = 0, best = 0;
  D.forEach(x => { const r = gradeOne(pk, x); if (r.tr != null) { tiers[r.tr]++; money += r.m; } best = Math.max(best, r.h); });
  const won = tiers.reduce((a, b) => a + b, 0);
  $('#hist').innerHTML = `<h3>如果這組號碼從 ${D[0].d.slice(0, 4)} 年起每期都買</h3>
    <p class="sub">共 ${fmt(D.length)} 期，花 ${fmt(D.length * 50)} 元，中獎 ${won} 次，拿回 ${fmt(money)} 元（${pct(money / (D.length * 50), 0)}）。最多一次對中 ${best} 個。</p>
    ${hbars(A.tier_names.map((t, i) => ({ lab: t, v: tiers[i], val: tiers[i] + ' 次', tip: `${t}：${tiers[i]} 次` })).filter(r => r.v > 0))}
    <p class="muted">大樂透的總獎金大約只有賣出金額的一半左右，長期買一定是賠錢的，這跟選什麼號碼無關。</p>`;
  bindTips(app);
}

function gradeOne(pk, d) {
  const h = pk.filter(v => d.n.includes(v)).length, sp = pk.includes(d.s);
  let tr = null;
  if (h === 6) tr = 0; else if (h === 5) tr = sp ? 1 : 2; else if (h === 4) tr = sp ? 3 : 4;
  else if (h === 3) tr = sp ? 5 : 7; else if (h === 2 && sp) tr = 6;
  const m = tr != null && d.w ? (d.w[tr] || 0) : 0;
  return { h, sp, tr, m };
}

// ---------------------------------------------------------------- 🎰 包牌試算
let RK = null;                       // ranks.json：回測期間每期各模型前 12 名
const comb = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };
const TIER = (k, sp) => k === 6 ? 0 : k === 5 ? (sp ? 1 : 2) : k === 4 ? (sp ? 3 : 4) : k === 3 ? (sp ? 5 : 7) : (k === 2 && sp ? 6 : null);

// 包牌一期：nums 裡任選 6 個的組合全買，回傳 { cost, money, tiers[8]（各獎項中幾注）, h, sp }
function wheelOne(nums, d) {
  const n = nums.length, h = nums.filter(v => d.n.includes(v)).length, sp = nums.includes(d.s) ? 1 : 0;
  const tiers = Array(8).fill(0); let money = 0;
  for (let k = 0; k <= Math.min(h, 6); k++) for (const ws of [0, 1]) {
    if (ws && !sp) continue;
    const cnt = comb(h, k) * comb(n - h - sp, 6 - k - ws), tr = TIER(k, !!ws);
    if (cnt && tr != null) { tiers[tr] += cnt; money += cnt * ((d.w && d.w[tr]) || 0); }
  }
  return { cost: comb(n, 6) * 50, money, tiers, h, sp };
}

function wheelRun(model, n) {
  const ps = RK.periods, list = RK.m[model], idx = new Map(D.map((d, i) => [d.p, i]));
  const rows = [], tiers = Array(8).fill(0);
  let cost = 0, money = 0, wins = 0, any = 0, streak = 0, maxStreak = 0, best = null;
  const half = Math.floor(ps.length / 2), hc = [0, 0], hm = [0, 0];
  ps.forEach((p, i) => {
    const d = D[idx.get(p)], r = wheelOne(list[i].slice(0, n), d);
    cost += r.cost; money += r.money; r.tiers.forEach((c, j) => tiers[j] += c);
    if (r.money > 0) any++;
    if (r.money >= r.cost) { wins++; streak = 0; } else { streak++; maxStreak = Math.max(maxStreak, streak); }
    if (!best || r.money > best.money) best = { p, d: d.d, money: r.money, h: r.h, sp: r.sp };
    const s = i < half ? 0 : 1; hc[s] += r.cost; hm[s] += r.money;
    rows.push({ p, d: d.d, ...r });
  });
  return { n: ps.length, cost, money, wins, any, maxStreak, best, tiers, rows, rate: money / cost, half: [hm[0] / hc[0], hm[1] / hc[1]] };
}

function vWheel() {
  if (!RK) {
    app.innerHTML = '<h1>包牌試算</h1><p class="sub">載入回測資料中…</p>';
    fetch('data/ranks.json?v=' + Date.now()).then(r => r.json()).then(j => { RK = j; if (curRoute() === 'wheel') vWheel(); })
      .catch(e => { app.innerHTML = `<p>回測資料載入失敗：${esc(e.message)}</p>`; });
    return;
  }
  const n = st.wn || 10;
  const ids = A.models.map(m => m.id);
  const all = {}; [...ids, 'random'].forEach(k => { all[k] = wheelRun(k, n); });
  const champ = ids.reduce((a, b) => all[b].rate > all[a].rate ? b : a);
  const mid = st.wm === 'best' ? champ : (st.wm || 'vote');
  const R = all[mid], RR = all.random;
  const tickets = comb(n, 6), price = tickets * 50;
  const top = A.next.picks[mid].top.slice(0, n);

  // 前後半段名次（照回收率，7 個模型比）
  const rankBy = s => { const o = [...ids].sort((a, b) => all[b].half[s] - all[a].half[s]); return Object.fromEntries(o.map((k, i) => [k, i + 1])); };
  const r1 = rankBy(0), r2 = rankBy(1);
  const c1 = ids.find(k => r1[k] === 1);
  const passed = r2[mid] <= 2 && r1[mid] <= 2;
  const halfMid = RK.periods[Math.floor(RK.periods.length / 2)];
  const dOf = p => D.find(d => d.p === p).d.slice(0, 7);
  const short = k => modelName(k).replace(/（.*）/, '');
  const rankNo = k => ids.filter(x => all[x].rate > all[k].rate).length + 1;

  let h = `<h1>包牌試算</h1>
  <div class="card">
    <div class="row"><span class="grow">號碼數</span><b id="wnv" style="font-size:20px">${n} 個</b></div>
    <input type="range" id="wn" min="6" max="12" value="${n}" style="width:100%;accent-color:var(--main)">
    <div class="row" style="margin-top:8px"><span class="grow">照哪個模型的排名</span>
      <select id="wm"><option value="best" ${st.wm === 'best' ? 'selected' : ''}>目前冠軍（${short(champ)}）</option>
      ${A.models.map(m => `<option value="${m.id}" ${st.wm !== 'best' && mid === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select></div>
    <p class="muted">特別號不用另外選：大樂透的特別號是開獎時另外開，用你包的號碼自動對。</p>
  </div>

  <h2>${roc(A.next.p)} 包牌號碼　<span class="sub">${A.next.d}</span></h2>
  <div class="card">${balls([...top].sort((a, b) => a - b))}
    <p style="margin-top:8px">${n} 個號碼任選 6 個＝<b>${fmt(tickets)} 注</b>，費用 <b>${fmt(price)} 元</b></p>
    <p class="muted">這是「${modelName(mid)}」排名前 ${n} 的號碼。「機率最高」其實是模型的排名，每個號碼真正的機率都是 6/49。</p></div>

  <h2>回測：${A.bt.from.slice(0, 4)} 年起每期都這樣包</h2>
  <p class="sub">從 ${A.bt.from} 到 ${A.bt.to}，共 ${fmt(R.n)} 期，每期都只用「當時」的模型排名前 ${n} 名包牌。</p>
  <div class="card">
    <div class="row"><span class="grow">勝率（當期拿回 ≥ 當期花費）</span><b style="font-size:22px">${pct(R.wins / R.n)}</b></div>
    <div class="sub">${fmt(R.n)} 期裡有 ${R.wins} 期有賺；有中任何獎的期數 ${R.any} 期（${pct(R.any / R.n, 0)}）</div>
    <table style="margin-top:8px">
      <tr><th></th><th>${short(mid)}</th><th>亂選對照</th></tr>
      <tr><td>總投入</td><td>${fmt(R.cost)}</td><td>${fmt(RR.cost)}</td></tr>
      <tr><td>總拿回</td><td>${fmt(R.money)}</td><td>${fmt(RR.money)}</td></tr>
      <tr><td>輸贏</td><td>${fmt(R.money - R.cost)}</td><td>${fmt(RR.money - RR.cost)}</td></tr>
      <tr><td>回收率</td><td><b>${pct(R.rate)}</b></td><td>${pct(RR.rate)}</td></tr>
      <tr><td>勝率</td><td>${pct(R.wins / R.n)}</td><td>${pct(RR.wins / RR.n)}</td></tr>
      <tr><td>最長連續沒回本</td><td>${R.maxStreak} 期</td><td>${RR.maxStreak} 期</td></tr>
    </table>
    <p class="sub" style="margin-top:8px">最好的一期：${roc(R.best.p)}（${R.best.d}），包中 ${R.best.h} 個${R.best.sp ? '＋特別號' : ''}，拿回 ${fmt(R.best.money)} 元。</p>
    <p class="muted">獎金用當期真實獎金。頭獎、貳獎若當期沒人中，用累積獎金估；若有人中，實際上你會跟他們平分，這裡沒有扣，所以結果略為樂觀。</p>
  </div>
  <div class="card"><h3>累積輸贏</h3>
    <div class="legend"><span><i style="background:var(--main)"></i>${short(mid)}</span><span><i style="background:var(--s2)"></i>亂選對照</span></div>
    <div id="cum"></div><p class="muted">線一路往下就是一路在賠錢。兩條線差不多，代表模型選號跟亂選沒有差別。點線看數字。</p></div>
  <div class="card"><h3>回測期間各獎項累計中幾注</h3>
    ${hbars(A.tier_names.map((t, i) => ({ lab: t, v: R.tiers[i], val: fmt(R.tiers[i]) + ' 注', tip: `${t}：${fmt(R.tiers[i])} 注（亂選對照 ${fmt(RR.tiers[i])} 注）` })).filter(r => r.v > 0))}</div>

  <h2>排行榜（每期包 ${n} 個號碼）</h2>
  <div class="card scroll"><table>
    <tr><th>模型</th><th>回收率</th><th>勝率</th><th>輸贏</th></tr>
    ${[...ids, 'random'].sort((a, b) => all[b].rate - all[a].rate).map(k => `<tr><td>${k === 'random' ? '' : rankNo(k) + '. '}${short(k)}${k === mid ? ' ◀' : ''}</td><td>${pct(all[k].rate)}</td><td>${pct(all[k].wins / all[k].n)}</td><td>${fmt(all[k].money - all[k].cost)}</td></tr>`).join('')}
  </table><p class="muted">◀ 是你目前選的模型。輸贏單位：元。</p>${champNote(all[champ], champ)}</div>

  <div class="card"><h3>考試：冠軍是真厲害還是運氣好？</h3>
    <p class="sub">把回測切成兩半：前半段（${dOf(RK.periods[0])} 起）、後半段（${dOf(halfMid)} 起），照回收率排名。真的厲害的模型，兩段都應該名列前茅。</p>
    <table><tr><th>模型</th><th>前半段</th><th>後半段</th></tr>
    ${[...ids].sort((a, b) => r1[a] - r1[b]).map(k => `<tr><td>${short(k)}</td><td>第 ${r1[k]} 名</td><td>第 ${r2[k]} 名</td></tr>`).join('')}</table>
    <p style="margin-top:8px"><b>前半段冠軍「${short(c1)}」到了後半段排第 ${r2[c1]} 名。</b></p>
    <p class="sub">${r2[c1] <= 2 ? '這次冠軍有守住前兩名，但只考一次還不夠，要看上線後的真實戰績能不能繼續贏。' : '冠軍沒有守住，代表前半段的好成績比較像是運氣，不是真的學到規律。'}
    你目前選的「${short(mid)}」：前半段第 ${r1[mid]} 名、後半段第 ${r2[mid]} 名，${passed ? '兩段都在前兩名。' : '沒有兩段都在前兩名。'}</p></div>

  <div class="card"><h3>最近 10 期明細</h3>
    ${R.rows.slice(-10).reverse().map(r => `<div style="margin:8px 0"><div class="row"><span class="grow muted">${roc(r.p)}　${r.d}</span>
      <span class="pill ${r.money >= r.cost ? 'ok' : ''}">${r.money >= r.cost ? '賺 ' : '賠 '}${fmt(Math.abs(r.money - r.cost))}</span></div>
      <div class="muted">包中 ${r.h} 個${r.sp ? '＋特別號' : ''}，花 ${fmt(r.cost)}、拿回 ${fmt(r.money)}</div></div>`).join('')}</div>
  ${wheelLive()}`;
  app.innerHTML = h;
  $('#cum').innerHTML = cumChart(R.rows, RR.rows);
  bindTips(app);
  const wn = $('#wn');
  wn.oninput = () => { $('#wnv').textContent = wn.value + ' 個'; };
  wn.onchange = () => { st.wn = +wn.value; save(); vWheel(); };
  $('#wm').onchange = e => { st.wm = e.target.value; save(); vWheel(); };
}

// 冠軍的成績是不是靠某一期大獎撐起來的
function champNote(r, k) {
  const b = r.best, rest = (r.money - b.money) / r.cost;
  if (b.money < r.cost * 0.1) return '';
  return `<p class="sub" style="margin-top:6px">⚠️ 冠軍「${modelName(k).replace(/（.*）/, '')}」的成績，主要來自 ${roc(b.p)}（${b.d}）那一期：包中 ${b.h} 個${b.sp ? '＋特別號' : ''}，一期拿回 ${fmt(b.money)} 元。扣掉這一期，回收率只有 ${pct(rest)}。一次大獎是運氣，不代表模型比較準。</p>`;
}

// 上線後包 10 個號碼的真實戰績
function wheelLive() {
  if (!L) return '';
  const done = Object.entries(L.preds).filter(([, e]) => e.wheel10).sort((a, b) => b[0] - a[0]);
  const h = `<h2>上線後真實戰績（包 10 個號碼）</h2>`;
  if (!done.length) return h + `<div class="card sub">每期開獎前都會把各模型前 12 名存檔，開獎後自動算包 10 個號碼的輸贏。第一期開完就有。</div>`;
  const sum = {};
  done.forEach(([, e]) => Object.entries(e.wheel10).forEach(([k, r]) => {
    const o = sum[k] || (sum[k] = { c: 0, m: 0, w: 0, n: 0 });
    o.c += r.cost; o.m += r.money; o.n++; if (r.money >= r.cost) o.w++;
  }));
  return h + `<div class="card scroll"><table><tr><th>模型</th><th>期數</th><th>回收率</th><th>有賺期數</th></tr>
    ${A.models.map(m => sum[m.id] ? `<tr><td>${m.name}</td><td>${sum[m.id].n}</td><td>${pct(sum[m.id].m / sum[m.id].c)}</td><td>${sum[m.id].w}</td></tr>` : '').join('')}</table></div>`;
}

function cumChart(a, b) {
  const W = 360, H = 200, pl = 48, pr = 8, pt = 10, pb = 22;
  const cum = rows => { let s = 0; return rows.map(r => (s += r.money - r.cost)); };
  const ca = cum(a), cb = cum(b), all = [...ca, ...cb, 0];
  const lo = Math.min(...all), hi = Math.max(...all);
  const x = i => pl + i / (ca.length - 1) * (W - pl - pr), y = v => pt + (hi - v) / (hi - lo || 1) * (H - pt - pb);
  const line = (arr, c) => `<polyline points="${arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`;
  const wan = v => (v < 0 ? '-' : '') + Math.round(Math.abs(v) / 10000).toLocaleString('zh-TW') + '萬';
  const ticks = [...new Set([lo, Math.round(lo / 2), 0, hi > Math.abs(lo) * 0.15 ? hi : 0])];
  const id = 'cc' + Math.random().toString(36).slice(2, 7);
  setTimeout(() => {
    const svg = document.getElementById(id); if (!svg) return;
    const cross = svg.querySelector('.cross');
    const mv = e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(ca.length - 1, Math.round((px - pl) / (W - pl - pr) * (ca.length - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.display = '';
      tip.textContent = `${a[i].d}　模型累積 ${wan(ca[i])}、亂選 ${wan(cb[i])}`; tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY - 40) + 'px';
    };
    svg.addEventListener('pointermove', mv); svg.addEventListener('pointerdown', mv);
    svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; cross.style.display = 'none'; });
  });
  return `<svg id="${id}" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;touch-action:pan-y">
    ${ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${pl - 4}" y="${y(t) + 4}" text-anchor="end">${t === 0 ? '0' : wan(t)}</text>`).join('')}
    ${line(cb, 'var(--s2)')}${line(ca, 'var(--main)')}
    <line class="cross" y1="${pt}" y2="${H - pb}" stroke="var(--sub)" style="display:none"/>
    <text x="${pl}" y="${H - 5}">${a[0].d.slice(0, 4)}</text><text x="${W - pr}" y="${H - 5}" text-anchor="end">${a[a.length - 1].d.slice(0, 4)}</text>
  </svg>`;
}

// ---------------------------------------------------------------- 路由
const VIEWS = { predict: vPredict, stats: vStats, wheel: vWheel, score: vScore, fair: vFair, check: vCheck };
function curRoute() { return (location.hash.match(/#\/(\w+)/) || [])[1] || 'predict'; }
function route() {
  const r = curRoute();
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r));
  tip.style.display = 'none';
  (VIEWS[r] || vPredict)();
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

(async () => {
  try {
    const get = u => fetch(u + '?v=' + Date.now()).then(r => r.ok ? r.json() : null);
    const [d, a, l] = await Promise.all([get('data/draws.json'), get('data/analysis.json'), get('data/live.json').catch(() => null)]);
    D = d.draws; A = a; L = l;
    route();
  } catch (e) {
    app.innerHTML = `<p>資料載入失敗，請確認網路後重新整理。</p><p class="muted">${esc(e.message)}</p>`;
  }
})();
