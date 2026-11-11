'use strict';

const FIT = Object.freeze({ E: 1.69, A: 406.4, B: 410.7, alpha: 0.34, beta: 0.28 });

function predictLoss(parameters, tokens) {
  return FIT.E + FIT.A / parameters ** FIT.alpha + FIT.B / tokens ** FIT.beta;
}

function optimalAllocation(compute) {
  const { A, B, alpha, beta } = FIT;
  const parameters = (alpha * A / (beta * B)) ** (1 / (alpha + beta))
    * (compute / 6) ** (beta / (alpha + beta));
  const tokens = compute / (6 * parameters);
  return { parameters, tokens, loss: predictLoss(parameters, tokens) };
}

function formatScale(value, digits = 2) {
  const [divisor, unit] = value >= 1e12 ? [1e12, 'T'] : value >= 1e9 ? [1e9, 'B'] : [1e6, 'M'];
  return `${(value / divisor).toFixed(digits)}${unit}`;
}

function superscript(value) {
  const symbols = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(value).split('').map(char => char === '-' ? '⁻' : symbols[Number(char)]).join('');
}

function scientific(value) {
  const exponent = Math.floor(Math.log10(value));
  return `${(value / 10 ** exponent).toFixed(2)} × 10${superscript(exponent)}`;
}

function svgElement(tag, attributes = {}, text = '') {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text) element.textContent = text;
  return element;
}

function chartText(svg, x, y, text, attributes = {}) {
  svg.append(svgElement('text', { x, y, fill: 'var(--muted)', 'font-size': 12, 'font-family': 'var(--font)', ...attributes }, text));
}

function chartLine(svg, x1, y1, x2, y2, attributes = {}) {
  svg.append(svgElement('line', { x1, y1, x2, y2, stroke: 'var(--line)', 'stroke-width': 1, ...attributes }));
}

function resetChart(svg, title, description) {
  const prefix = svg.id === 'power-chart' ? 'power' : 'allocation';
  svg.replaceChildren(
    svgElement('title', { id: `${prefix}-title` }, title),
    svgElement('desc', { id: `${prefix}-desc` }, description)
  );
}

function pathFrom(points) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

function initializeTheme() {
  const button = document.querySelector('.theme-toggle');
  let savedTheme;
  try { savedTheme = localStorage.getItem('scaling-law-theme'); } catch { savedTheme = null; }
  let theme = savedTheme === 'light' ? 'light' : 'dark';
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.setAttribute('aria-label', `切换到${theme === 'dark' ? '浅' : '深'}色模式`);
    button.querySelector('span').textContent = theme === 'dark' ? '浅色' : '深色';
  };
  apply();
  button.addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    apply();
    try { localStorage.setItem('scaling-law-theme', theme); } catch { return; }
  });
}

function initializeNavigation() {
  const links = [...document.querySelectorAll('.toc a[href^="#"]')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  const percent = document.getElementById('reading-percent');
  const bar = document.getElementById('reading-bar');
  let pending = false;
  const update = () => {
    const threshold = window.innerWidth <= 760 ? 160 : 130;
    let active = 0;
    sections.forEach((section, index) => {
      if (section && section.getBoundingClientRect().top <= threshold) active = index;
    });
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? Math.min(100, Math.max(0, window.scrollY / scrollable * 100)) : 100;
    if (progress >= 99) active = links.length - 1;
    links.forEach((link, index) => {
      link.classList.toggle('active', index === active);
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    if (percent) percent.textContent = `${Math.round(progress)}%`;
    if (bar) bar.style.width = `${progress}%`;
    pending = false;
  };
  const requestUpdate = () => {
    if (!pending) {
      pending = true;
      window.requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  window.addEventListener('hashchange', requestUpdate);
  update();
}

function initializePowerLaw() {
  const svg = document.getElementById('power-chart');
  if (!svg) return;
  const input = document.getElementById('alpha');
  const buttons = [...document.querySelectorAll('[data-scale]')];
  let scale = 'linear';
  const render = () => {
    const alpha = Number(input.value);
    const logarithmic = scale === 'log';
    const compact = window.innerWidth <= 500;
    svg.dataset.compact = String(compact);
    svg.setAttribute('viewBox', `0 0 ${compact ? 400 : 780} 270`);
    const plot = { left: 58, right: compact ? 375 : 750, top: 28, bottom: 222 };
    const xMap = x => plot.left + (logarithmic ? Math.log10(x) / 2 : (x - 1) / 99) * (plot.right - plot.left);
    const yMin = logarithmic ? 0.05 : 0;
    const yMap = y => plot.bottom - (logarithmic
      ? (Math.log10(y) - Math.log10(yMin)) / -Math.log10(yMin)
      : y) * (plot.bottom - plot.top);
    const reduction = (1 - 10 ** -alpha) * 100;
    resetChart(svg, `幂律曲线：${logarithmic ? '双对数' : '线性'}坐标`,
      `教学函数 ΔL = x 的负 ${alpha.toFixed(2)} 次方。相对资源从 1 增加到 100；资源增加十倍时，可约损失下降 ${reduction.toFixed(1)}%。${logarithmic ? '双对数坐标下为一条直线。' : '线性坐标下呈边际收益递减的曲线。'}`);
    const xTicks = logarithmic
      ? (compact ? [1, 10, 100] : [1, 2, 5, 10, 20, 50, 100])
      : (compact ? [1, 25, 50, 75, 100] : [1, 20, 40, 60, 80, 100]);
    const yTicks = logarithmic ? [0.05, 0.1, 0.2, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    xTicks.forEach(x => {
      chartLine(svg, xMap(x), plot.top, xMap(x), plot.bottom);
      chartText(svg, xMap(x), plot.bottom + 21, String(x), { 'text-anchor': 'middle' });
    });
    yTicks.forEach(y => {
      chartLine(svg, plot.left, yMap(y), plot.right, yMap(y));
      chartText(svg, plot.left - 12, yMap(y) + 4, String(y), { 'text-anchor': 'end' });
    });
    const points = Array.from({ length: 180 }, (_, index) => {
      const x = 10 ** (2 * index / 179);
      return [xMap(x), yMap(x ** -alpha)];
    });
    svg.append(svgElement('path', { d: pathFrom(points), stroke: 'var(--accent)', 'stroke-width': 3, fill: 'none' }));
    const markerX = xMap(10);
    const markerY = yMap(10 ** -alpha);
    chartLine(svg, markerX, markerY, markerX, plot.bottom, { stroke: 'var(--orange)', 'stroke-dasharray': '4 5' });
    svg.append(svgElement('circle', { cx: markerX, cy: markerY, r: 5, fill: 'var(--orange)', stroke: 'var(--surface)', 'stroke-width': 2 }));
    chartText(svg, markerX + 13, markerY - 10, `×10 → ${(10 ** -alpha).toFixed(3)}`, { fill: 'var(--orange)', 'font-size': 13 });
    chartText(svg, plot.left, 15, `可约损失 ΔL${logarithmic ? ' · 对数轴' : ''}`, { 'font-size': 11 });
    chartText(svg, plot.right, 265, `相对资源 x${logarithmic ? ' · 对数轴' : ''}`, { 'text-anchor': 'end', 'font-size': 11 });
    document.getElementById('alpha-value').textContent = alpha.toFixed(2);
    document.getElementById('power-result').textContent = `资源 ×10 → 可约损失下降 ${reduction.toFixed(1)}%`;
    input.setAttribute('aria-valuetext', `幂律指数 ${alpha.toFixed(2)}`);
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scale === scale)));
  };
  input.addEventListener('input', render);
  window.addEventListener('resize', render);
  buttons.forEach(button => button.addEventListener('click', () => {
    scale = button.dataset.scale;
    render();
  }));
  render();
}

function initializeAllocation() {
  const svg = document.getElementById('allocation-chart');
  if (!svg) return;
  const computeInput = document.getElementById('compute');
  const ratioInput = document.getElementById('model-ratio');
  const presets = [...document.querySelectorAll('[data-budget]')];
  const setText = (id, text) => { document.getElementById(id).textContent = text; };
  const render = () => {
    const compute = 10 ** Number(computeInput.value);
    const factor = 10 ** Number(ratioInput.value);
    const optimal = optimalAllocation(compute);
    const parameters = optimal.parameters * factor;
    const tokens = compute / (6 * parameters);
    const loss = predictLoss(parameters, tokens);
    const gap = Math.max(0, loss - optimal.loss);
    const unit = document.createElement('small');
    unit.textContent = 'FLOPs';
    document.getElementById('compute-value').replaceChildren(`${scientific(compute)} `, unit);
    setText('ratio-value', `${factor.toFixed(2)}×`);
    setText('result-n', formatScale(parameters));
    setText('result-d', formatScale(tokens));
    setText('result-loss', loss.toFixed(3));
    setText('result-ratio', (tokens / parameters).toFixed(1));
    setText('optimal-n', formatScale(optimal.parameters));
    setText('optimal-d', formatScale(optimal.tokens));
    setText('optimal-loss', optimal.loss.toFixed(3));
    setText('loss-gap', `比最优高 ${gap.toFixed(3)} nats/token`);
    computeInput.setAttribute('aria-valuetext', `${scientific(compute)} FLOPs`);
    ratioInput.setAttribute('aria-valuetext', `${factor.toFixed(2)} 倍拟合最优参数量，${formatScale(parameters)} 参数`);
    presets.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.budget) === Number(computeInput.value))));
    const verdict = document.getElementById('lab-verdict');
    const nearOptimal = Math.abs(Number(ratioInput.value)) < 0.06;
    verdict.dataset.state = nearOptimal ? 'optimal' : 'imbalanced';
    verdict.textContent = nearOptimal
      ? '接近拟合最优：参数项与数据项的边际收益取得平衡。这个最优点只对当前经验函数与训练计算预算成立。'
      : factor < 1
        ? '模型偏小：你把更多预算分给了训练 token，但容量限制开始占主导。适当增大模型可降低该拟合函数的损失。'
        : '模型偏大：单个 token 的计算更贵，留给训练数据的预算不足。适当减小模型、增加 token 可降低预测损失。';
    const compact = window.innerWidth <= 500;
    svg.dataset.compact = String(compact);
    svg.setAttribute('viewBox', `0 0 ${compact ? 400 : 620} 320`);
    const plot = { left: 61, right: compact ? 366 : 588, top: 35, bottom: 255 };
    const pointLoss = logRatio => {
      const n = optimal.parameters * 10 ** logRatio;
      return predictLoss(n, compute / (6 * n));
    };
    const maxLoss = Math.max(pointLoss(-1), pointLoss(1));
    const span = maxLoss - optimal.loss;
    const yMin = optimal.loss - span * 0.18;
    const yMax = maxLoss + span * 0.15;
    const xMap = logRatio => plot.left + (logRatio + 1) / 2 * (plot.right - plot.left);
    const yMap = value => plot.bottom - (value - yMin) / (yMax - yMin) * (plot.bottom - plot.top);
    resetChart(svg, '固定预算下的 IsoFLOP 曲线',
      `计算预算 ${scientific(compute)} FLOPs。拟合最优参数 ${formatScale(optimal.parameters)}，训练 token ${formatScale(optimal.tokens)}，最低预测损失 ${optimal.loss.toFixed(3)} nats/token。当前参数 ${formatScale(parameters)}，预测损失 ${loss.toFixed(3)} nats/token，比最优高 ${gap.toFixed(3)}。横轴对数，纵轴线性；坐标范围随预算变化。`);
    for (let i = 0; i <= 4; i++) {
      const value = yMin + i / 4 * (yMax - yMin);
      chartLine(svg, plot.left, yMap(value), plot.right, yMap(value));
      chartText(svg, plot.left - 10, yMap(value) + 4, value.toFixed(2), { 'text-anchor': 'end' });
    }
    (compact ? [-1, 0, 1] : [-1, -0.5, 0, 0.5, 1]).forEach(logRatio => {
      const x = xMap(logRatio);
      chartLine(svg, x, plot.top, x, plot.bottom);
      chartText(svg, x, plot.bottom + 23, formatScale(optimal.parameters * 10 ** logRatio, 1), { 'text-anchor': 'middle' });
    });
    const points = Array.from({ length: 151 }, (_, index) => {
      const logRatio = -1 + index / 75;
      return [xMap(logRatio), yMap(pointLoss(logRatio))];
    });
    const line = pathFrom(points);
    svg.append(svgElement('path', { d: `${line} L${plot.right},${plot.bottom} L${plot.left},${plot.bottom} Z`, fill: 'var(--accent-light)', opacity: 0.65 }));
    svg.append(svgElement('path', { d: line, stroke: 'var(--accent)', 'stroke-width': 3, fill: 'none' }));
    chartLine(svg, xMap(0), yMap(optimal.loss), xMap(0), plot.bottom, { stroke: 'var(--accent)', 'stroke-dasharray': '4 4' });
    svg.append(svgElement('circle', { cx: xMap(0), cy: yMap(optimal.loss), r: 8, fill: 'var(--surface)', stroke: 'var(--accent)', 'stroke-width': 2.5 }));
    const currentX = xMap(Number(ratioInput.value));
    const currentY = yMap(loss);
    chartLine(svg, currentX, currentY, currentX, plot.bottom, { stroke: 'var(--orange)', 'stroke-dasharray': '3 5', opacity: 0.7 });
    svg.append(svgElement('circle', { cx: currentX, cy: currentY, r: 5, fill: 'var(--orange)', stroke: 'var(--surface)', 'stroke-width': 1.5 }));
    chartText(svg, xMap(0), yMap(optimal.loss) - 17, '拟合最优', { 'text-anchor': 'middle', fill: 'var(--accent)', 'font-size': 13 });
    chartText(svg, plot.left, 17, compact ? '容量受限' : '模型偏小 / 容量受限', { 'font-size': 11 });
    chartText(svg, plot.right, 17, compact ? 'token 不足' : '模型偏大 / token 不足', { 'text-anchor': 'end', 'font-size': 11 });
    chartText(svg, plot.right, 312, compact ? '参数量 N · 对数轴' : '参数量 N · 对数轴（范围随预算变化）', { 'text-anchor': 'end', 'font-size': 11 });
  };
  window.addEventListener('resize', render);
  computeInput.addEventListener('input', render);
  ratioInput.addEventListener('input', render);
  presets.forEach(button => button.addEventListener('click', () => {
    computeInput.value = button.dataset.budget;
    render();
  }));
  document.getElementById('reset-optimal').addEventListener('click', () => {
    ratioInput.value = '0';
    render();
  });
  render();
}

function initializeQuiz() {
  const feedback = document.getElementById('quiz-feedback');
  if (!feedback) return;
  const buttons = [...document.querySelectorAll('[data-answer]')];
  const answers = {
    model: '这会消耗 4 倍算力，但没有按题设同步扩展数据；在这条计算最优路径上，应将 N 和 D 各扩大 2 倍。',
    balanced: '正确。√4 = 2；参数 ×2、数据 ×2，训练计算量 6ND 恰好 ×4。这是“同比例扩展”的含义。',
    both: '再想一下：N 和 D 都 ×4，会使 6ND 变成 16 倍，超出了 4 倍预算。应各扩大 2 倍。'
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    feedback.textContent = answers[button.dataset.answer];
    feedback.dataset.correct = String(button.dataset.answer === 'balanced');
  }));
}

function initializeNotesDialog() {
  const dialog = document.getElementById('notes-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const content = document.getElementById('notes-content');
  const topic = document.getElementById('notes-topic');
  const closeButton = dialog.querySelector('.notes-close');
  const panels = [...content.querySelectorAll('[data-note-panel]')];
  let trigger = null;
  const showTopic = requested => {
    const selected = panels.find(panel => panel.dataset.notePanel === requested) || panels[0];
    topic.value = selected.dataset.notePanel;
    panels.forEach(panel => { panel.hidden = panel !== selected; });
    content.setAttribute('aria-label', `补充说明：${topic.selectedOptions[0].textContent}`);
    content.scrollTop = 0;
  };
  document.querySelectorAll('button[data-note]').forEach(button => {
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'notes-dialog');
    button.addEventListener('click', () => {
      trigger = button;
      showTopic(button.dataset.note);
      dialog.showModal();
      document.documentElement.classList.add('notes-open');
      closeButton.focus({ preventScroll: true });
    });
  });
  topic.addEventListener('change', () => showTopic(topic.value));
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const targets = [...dialog.querySelectorAll('a[href], button, select, [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0);
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('notes-open');
    trigger?.focus({ preventScroll: true });
  });
}

initializeTheme();
initializeNavigation();
initializePowerLaw();
initializeAllocation();
initializeQuiz();
initializeNotesDialog();
