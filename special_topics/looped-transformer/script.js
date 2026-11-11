(() => {
  'use strict';

  const root = document.documentElement;
  const themeButton = document.querySelector('.theme-toggle');
  const storageKey = 'looped-transformer-theme';

  function setTheme(theme) {
    root.dataset.theme = theme;
    if (themeButton) {
      themeButton.textContent = theme === 'dark' ? '切换浅色模式' : '切换深色模式';
      themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }

  let savedTheme;
  try {
    savedTheme = localStorage.getItem(storageKey);
  } catch {
    savedTheme = null;
  }
  setTheme(savedTheme === 'light' ? 'light' : 'dark');

  themeButton?.addEventListener('click', () => {
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      return;
    }
  });

  const tocLinks = [...document.querySelectorAll('.toc a[href^="#"]')];
  const sections = tocLinks.map(link => document.getElementById(link.hash.slice(1)));
  const progressBar = document.querySelector('.reading-progress span');
  let scrollPending = false;

  function updateReadingPosition() {
    let activeIndex = 0;
    sections.forEach((section, index) => {
      if (section && section.getBoundingClientRect().top <= 180) activeIndex = index;
    });
    if (window.innerHeight + window.scrollY >= root.scrollHeight - 8) {
      activeIndex = Math.max(0, tocLinks.length - 1);
    }
    tocLinks.forEach((link, index) => {
      link.classList.toggle('active', index === activeIndex);
      if (index === activeIndex) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    if (progressBar) {
      const scrollable = root.scrollHeight - window.innerHeight;
      const fraction = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 1;
      progressBar.style.width = `${fraction * 100}%`;
    }
    scrollPending = false;
  }

  function scheduleReadingUpdate() {
    if (!scrollPending) {
      scrollPending = true;
      requestAnimationFrame(updateReadingPosition);
    }
  }

  window.addEventListener('scroll', scheduleReadingUpdate, { passive: true });
  window.addEventListener('resize', scheduleReadingUpdate);
  window.addEventListener('load', updateReadingPosition);
  document.querySelectorAll('details').forEach(detail => detail.addEventListener('toggle', scheduleReadingUpdate));
  updateReadingPosition();

  const drawer = document.getElementById('note-drawer');
  if (drawer && typeof drawer.showModal === 'function') {
    const body = document.getElementById('note-body');
    const closeButton = document.getElementById('note-close');
    const backButton = document.getElementById('note-back');
    const history = [];
    let current;
    let opener;
    let previousOverflow;
    let mainTarget;

    function prepareLinks(container, insideDrawer = false) {
      container.querySelectorAll('a[href^="#"]').forEach(link => {
        const href = link.getAttribute('href');
        const match = href.match(/^#note-([^/]+)(?:\/(.+))?$/);
        if (!match && !insideDrawer) return;
        if (match && !document.getElementById(`note-${link.dataset.note || match[1]}`)) return;
        if (!match && !document.getElementById(href.slice(1))) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = link.className || 'inline-link';
        button.innerHTML = link.innerHTML;
        if (link.title) button.title = link.title;
        if (link.hasAttribute('aria-label')) button.setAttribute('aria-label', link.getAttribute('aria-label'));
        if (match) {
          button.dataset.note = link.dataset.note || match[1];
          if (!link.dataset.note && match[2]) button.dataset.noteSection = match[2];
          button.setAttribute('aria-haspopup', 'dialog');
          button.setAttribute('aria-controls', 'note-drawer');
        } else {
          button.dataset.mainSection = href.slice(1);
        }
        if (button.classList.contains('reading-card')) {
          button.querySelectorAll('h3, p').forEach(element => {
            const span = document.createElement('span');
            span.className = element.tagName === 'H3' ? 'card-heading' : 'card-description';
            span.innerHTML = element.innerHTML;
            element.replaceWith(span);
          });
        }
        link.replaceWith(button);
      });
    }

    function renderNote(frame) {
      const source = document.getElementById(`note-${frame.note}`);
      const content = source.content || source.querySelector('.note-content');
      body.replaceChildren(content.cloneNode(true));
      body.querySelectorAll('[id]').forEach(element => { element.id = `drawer-${element.id}`; });
      prepareLinks(body, true);
      current = frame;
      drawer.dataset.note = frame.note;
      drawer.classList.toggle('wide', source.hasAttribute('data-note-source'));
      backButton.hidden = history.length === 0;
      const section = [...body.querySelectorAll('[id]')].find(element => element.id === `drawer-note-${frame.note}/${frame.section}`);
      document.getElementById('note-title').textContent = section?.querySelector('h2')?.textContent || source.dataset.title;
      if (!drawer.open) drawer.showModal();
      closeButton.focus({ preventScroll: true });
      body.scrollTop = 0;
      if (frame.scrollTop !== undefined) body.scrollTop = frame.scrollTop;
      else if (section) body.scrollTop = section.getBoundingClientRect().top - body.getBoundingClientRect().top;
    }

    function openNote(trigger) {
      const note = trigger.dataset.note;
      if (!document.getElementById(`note-${note}`)) return;
      if (drawer.open) history.push({ ...current, scrollTop: body.scrollTop });
      else {
        history.length = 0;
        opener = trigger;
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }
      renderNote({ note, section: trigger.dataset.noteSection });
    }

    prepareLinks(document);
    document.querySelectorAll('[data-note-source]').forEach(source => { source.hidden = true; });
    document.addEventListener('click', event => {
      const trigger = event.target.closest('button[data-note], button[data-main-section]');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      if (trigger.dataset.note) openNote(trigger);
      else {
        mainTarget = document.getElementById(trigger.dataset.mainSection);
        drawer.close();
      }
    }, true);
    closeButton.addEventListener('click', () => drawer.close());
    backButton.addEventListener('click', () => {
      const frame = history.pop();
      if (!frame) return;
      renderNote(frame);
      if (!backButton.hidden) backButton.focus({ preventScroll: true });
    });
    drawer.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled]), summary, [tabindex="0"]')]
        .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    drawer.addEventListener('click', event => {
      const bounds = drawer.getBoundingClientRect();
      if (event.target === drawer && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) drawer.close();
    });
    drawer.addEventListener('close', () => {
      document.body.style.overflow = previousOverflow || '';
      if (mainTarget) {
        const target = mainTarget;
        const hadTabindex = target.hasAttribute('tabindex');
        if (!hadTabindex) target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ block: 'start', behavior: 'auto' });
        target.focus({ preventScroll: true });
        if (!hadTabindex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
        mainTarget = null;
      } else opener?.focus({ preventScroll: true });
      history.length = 0;
      current = null;
      body.replaceChildren();
    });
  }

  const memoryInput = document.getElementById('memory-budget');
  if (!memoryInput) return;

  const weightsInput = document.getElementById('weight-memory');
  const retentionInput = document.getElementById('weight-retention');
  const contextInput = document.getElementById('context-length');
  const kvRatioInput = document.getElementById('kv-ratio');
  const kneeInput = document.getElementById('batch-knee');
  const reserveGiB = 16;
  const kvBytesPerToken = 2 * 32 * 8 * 128 * 2;

  function renderCapacity() {
    const memory = Number(memoryInput.value);
    const weights = Number(weightsInput.value);
    const retention = Number(retentionInput.value) / 100;
    const context = Number(contextInput.value);
    const kvRatio = Number(kvRatioInput.value);
    const knee = Number(kneeInput.value);
    const baselineKV = context * kvBytesPerToken / (1024 ** 3);
    const loopKV = baselineKV * kvRatio;
    const baseline = Math.max(0, Math.floor((memory - weights - reserveGiB) / baselineKV));
    const loop = Math.max(0, Math.floor((memory - weights * retention - reserveGiB) / loopKV));
    const scale = Math.max(1, baseline, loop);
    const number = value => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    const percent = value => `${(value * 100).toFixed(1)}%`;
    const change = value => `${value >= 0 ? '+' : ''}${percent(value)}`;

    document.getElementById('memory-budget-value').value = `${memory} GiB`;
    document.getElementById('weight-memory-value').value = `${weights} GiB`;
    document.getElementById('weight-retention-value').value = `${retentionInput.value}%`;
    document.getElementById('batch-knee-value').value = String(knee);
    document.getElementById('baseline-capacity').textContent = `${number(baseline)} 请求`;
    document.getElementById('loop-capacity').textContent = `${number(loop)} 请求`;
    document.getElementById('baseline-bar').style.width = `${baseline / scale * 100}%`;
    document.getElementById('loop-bar').style.width = `${loop / scale * 100}%`;

    const baselineRate = baseline / (baseline + knee);
    const loopRate = loop / (loop + knee);
    let result = `每请求 KV：${number(baselineKV)} → ${number(loopKV)} GiB。容量上限 ${number(baseline)} → ${number(loop)}`;
    if (baseline > 0) {
      result += `（${change(loop / baseline - 1)}）。同一示意饱和曲线下，吞吐为上限的 ${percent(baselineRate)} → ${percent(loopRate)}（${change(loopRate / baselineRate - 1)}），不是实测增益。`;
    } else {
      result += `。基线在预留空间后无法容纳一个请求，相对增幅无定义；循环模型${loop > 0 ? '跨过了可部署门槛' : '也无法容纳一个请求'}。`;
    }
    if (kvRatio !== 1) result += ' 当前 q ≠ 1，缓存变化不是权重共享自动带来的收益或代价。';
    document.getElementById('capacity-result').textContent = result;
    scheduleReadingUpdate();
  }

  [memoryInput, weightsInput, retentionInput, contextInput, kvRatioInput, kneeInput].forEach(input => {
    input.addEventListener('input', renderCapacity);
    input.addEventListener('change', renderCapacity);
  });
  renderCapacity();
})();
