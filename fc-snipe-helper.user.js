// ==UserScript==
// @name         FC Snipe Helper
// @namespace    https://github.com/Saytrix08/Fifa-sniper
// @version      0.1.1
// @description  Overlay für die EA FC Web App: Snipe-Liste, Suchfilter per Klick ausfüllen, Mindest-Sofortkaufpreis automatisch hochsetzen, Gewinn nach Steuer. Suchen und Kaufen klickst du selbst.
// @match        https://*.ea.com/*web-app*
// @noframes
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Preislogik (ohne DOM, wird von test/price.test.js geprüft)
  // ---------------------------------------------------------------------------

  const MIN_BIN = 200;
  const MAX_PRICE = 15000000;

  // Preisstufen auf dem Transfermarkt: bis 1.000 in 50er-, bis 10.000 in
  // 100er-, bis 50.000 in 250er-, bis 100.000 in 500er-, darüber 1.000er-Schritte.
  function stepAbove(price) {
    if (price < 1000) return 50;
    if (price < 10000) return 100;
    if (price < 50000) return 250;
    if (price < 100000) return 500;
    return 1000;
  }

  function nextPrice(price) {
    if (!price || price < MIN_BIN) return MIN_BIN;
    return Math.min(price + stepAbove(price), MAX_PRICE);
  }

  function floorToValid(price) {
    if (price < MIN_BIN) return 0;
    const step = stepAbove(price);
    return Math.min(Math.floor(price / step) * step, MAX_PRICE);
  }

  // EA behält 5 % Steuer ein (aufgerundet).
  function afterTax(price) {
    return price - Math.ceil((price * 5) / 100);
  }

  function profitOf(buyPrice, sellPrice) {
    return afterTax(sellPrice) - buyPrice;
  }

  function maxBuyFor(sellPrice, minProfit) {
    return floorToValid(afterTax(sellPrice) - (minProfit || 0));
  }

  function parseCoins(text) {
    const digits = String(text || '').replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : 0;
  }

  // Nächster Mindest-Sofortkaufpreis für die nächste Suche. Jeder neue Wert
  // macht die Suche zu einer neuen Abfrage; nach `cycleSteps` Erhöhungen (oder
  // bevor der Max-Preis erreicht wird) geht es zurück auf leer.
  function nextMinBin(current, maxBin, bumps, cycleSteps) {
    const value = nextPrice(current);
    if (bumps >= cycleSteps || (maxBin && value >= maxBin)) return { value: 0, bumps: 0 };
    return { value, bumps: bumps + 1 };
  }

  function fmt(n) {
    return Number(n).toLocaleString('de-DE');
  }

  const api = { stepAbove, nextPrice, floorToValid, afterTax, profitOf, maxBuyFor, parseCoins, nextMinBin, fmt };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  // ---------------------------------------------------------------------------
  // Web App
  // ---------------------------------------------------------------------------

  // Falls EA die Web App umbaut, hier anpassen. „Diagnose“ im Overlay zeigt,
  // welche Elemente gefunden werden.
  const SELECTORS = {
    filtersView: '.ut-market-search-filters-view',
    playerName: '.ut-player-search-control input',
    // Reihenfolge: Gebot min, Gebot max, Sofortkauf min, Sofortkauf max
    priceInputs: '.search-prices .price-filter input',
    searchButton: '.btn-standard.call-to-action',
    resultItem: '.listFUTItem',
    noResults: '.ut-no-results-view',
    // Letzter Treffer innerhalb einer Karte = Sofortkaufpreis
    itemPrices: '.auction .auctionValue .currency-coins.value',
    navTab: '.ut-tab-bar-item',
  };
  const PRICE = { minBid: 0, maxBid: 1, minBin: 2, maxBin: 3 };

  const STORE_KEY = 'fcSnipeHelper.v1';
  const DEFAULTS = {
    targets: [],
    activeId: null,
    bumps: 0,
    log: [],
    collapsed: false,
    settings: { bumpMode: 'empty', cycleSteps: 10 },
  };

  let data;
  let root;
  let host;
  const session = { searchPending: false, lastResult: null, filtersVisible: false, cheapest: 0, searchTimes: [], emptyCount: 0 };

  function load() {
    const base = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved) return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
    } catch (e) {
      // Speicher kaputt oder blockiert → Standardwerte
    }
    return base;
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      // Speicher voll oder blockiert – Overlay funktioniert trotzdem weiter
    }
  }

  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));
  const isVisible = (el) => !!el && el.getClientRects().length > 0;

  function filtersView() {
    return $$(SELECTORS.filtersView).find(isVisible) || null;
  }

  function activeTarget() {
    return data.targets.find((t) => t.id === data.activeId) || null;
  }

  function setInputValue(input, value, keepFocus) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (!keepFocus) input.blur();
  }

  function fillFilters(target) {
    const view = filtersView();
    if (!view) return notify('Öffne zuerst „Transfermarkt durchsuchen“.');
    const prices = $$(SELECTORS.priceInputs, view);
    if (prices.length < 4) return notify('Preisfelder nicht gefunden – siehe Einstellungen → Diagnose.');
    setInputValue(prices[PRICE.minBin], '');
    setInputValue(prices[PRICE.maxBin], String(target.maxBuy));
    data.bumps = 0;
    save();
    const name = $(SELECTORS.playerName, view);
    if (!name) return notify('Max. Sofortkauf gesetzt, Namensfeld nicht gefunden – Spieler bitte selbst eintippen.');
    setInputValue(name, target.name, true);
    notify(`Max. Sofortkauf ${fmt(target.maxBuy)} gesetzt – jetzt die richtige Karte in der Vorschlagsliste wählen.`);
  }

  function bumpMinBin() {
    const view = filtersView();
    const prices = view ? $$(SELECTORS.priceInputs, view) : [];
    if (prices.length < 4) return;
    const minEl = prices[PRICE.minBin];
    const next = nextMinBin(parseCoins(minEl.value), parseCoins(prices[PRICE.maxBin].value), data.bumps, data.settings.cycleSteps);
    setInputValue(minEl, next.value ? String(next.value) : '');
    data.bumps = next.bumps;
    save();
    notify(next.value ? `Min. Sofortkauf → ${fmt(next.value)}` : 'Min. Sofortkauf zurückgesetzt');
  }

  // ---------------------------------------------------------------------------
  // Beobachten, was in der Web App passiert
  // ---------------------------------------------------------------------------

  function onSearchClicked() {
    const now = Date.now();
    session.searchPending = true;
    session.lastResult = null;
    session.cheapest = 0;
    session.searchTimes = session.searchTimes.filter((t) => now - t < 3600000);
    session.searchTimes.push(now);
    renderStatus();
  }

  function finishSearch(kind) {
    session.searchPending = false;
    session.lastResult = kind;
    if (kind === 'empty') session.emptyCount++;
    renderStatus();
  }

  function scan() {
    const visible = !!filtersView();
    if (session.searchPending && !visible) {
      if ($$(SELECTORS.noResults).some(isVisible)) finishSearch('empty');
      else if ($$(SELECTORS.resultItem).some(isVisible)) finishSearch('found');
    }
    if (session.lastResult === 'found' && !visible) annotateResults();
    // Zurück auf der Suchseite nach einer Suche → Mindestpreis für die nächste Suche anpassen
    if (visible && !session.filtersVisible && session.lastResult) {
      if (data.settings.bumpMode === 'always' || session.lastResult === 'empty') bumpMinBin();
      session.lastResult = null;
    }
    session.filtersVisible = visible;
  }

  function annotateResults() {
    const target = activeTarget();
    let cheapest = 0;
    for (const item of $$(SELECTORS.resultItem).filter(isVisible)) {
      const prices = $$(SELECTORS.itemPrices, item);
      const bin = prices.length ? parseCoins(prices[prices.length - 1].textContent) : 0;
      if (!bin) continue;
      if (!cheapest || bin < cheapest) cheapest = bin;
      if (target && target.sellPrice) setBadge(item, profitOf(bin, target.sellPrice));
    }
    if (cheapest !== session.cheapest) {
      session.cheapest = cheapest;
      renderStatus();
    }
  }

  function setBadge(item, profit) {
    let badge = item.querySelector('.fcsh-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'fcsh-badge';
      badge.style.cssText =
        'position:absolute;top:4px;right:6px;z-index:5;padding:2px 6px;border-radius:4px;' +
        'font:600 12px/1.4 system-ui,sans-serif;color:#fff;pointer-events:none;';
      if (getComputedStyle(item).position === 'static') item.style.position = 'relative';
      item.appendChild(badge);
    }
    const text = `${profit >= 0 ? '+' : ''}${fmt(profit)}`;
    if (badge.textContent !== text) badge.textContent = text;
    badge.style.background = profit >= 0 ? '#1f9d55' : '#c53030';
  }

  function watchWebApp() {
    let timer = null;
    new MutationObserver(() => {
      attachHost();
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        scan();
      }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener(
      'pointerup',
      (e) => {
        const el = e.target instanceof Element ? e.target : null;
        if (!el) return;
        const view = filtersView();
        const btn = el.closest(SELECTORS.searchButton);
        if (btn && view && view.contains(btn)) onSearchClicked();
        else if (el.closest(SELECTORS.navTab)) {
          session.searchPending = false;
          session.lastResult = null;
        }
      },
      true
    );
  }

  // ---------------------------------------------------------------------------
  // Overlay
  // ---------------------------------------------------------------------------

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { width: 330px; max-height: calc(100vh - 96px); overflow: auto; background: #14161c; color: #e8eaf0;
      border: 1px solid #2c303b; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.45);
      font: 13px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px;
      background: #1c1f27; border-bottom: 1px solid #2c303b; position: sticky; top: 0; z-index: 1; }
    .collapsed .body { display: none; }
    .collapsed .head { border-bottom: 0; }
    .body { padding: 10px; display: grid; gap: 10px; }
    .status { display: grid; gap: 2px; padding: 8px; border-radius: 8px; background: #1c1f27; }
    .muted { color: #9aa1b2; }
    .msg { min-height: 1em; color: #f6c35b; }
    .msg:empty { display: none; }
    #targets { display: grid; gap: 8px; }
    .target { display: grid; grid-template-columns: 1fr auto; gap: 6px; padding: 8px; border-radius: 8px;
      background: #1c1f27; border: 1px solid transparent; }
    .target.active { border-color: #3b82f6; }
    .target.done .t-name { text-decoration: line-through; color: #9aa1b2; }
    .t-name { font-weight: 600; }
    .t-count { font-weight: 600; align-self: start; }
    .t-actions { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; }
    .pos { color: #4ade80; } .neg { color: #f87171; }
    button { font: inherit; color: #e8eaf0; background: #2a2f3b; border: 1px solid #3a4050; border-radius: 6px;
      padding: 4px 9px; cursor: pointer; }
    button:hover { background: #343a48; }
    button.primary { background: #2563eb; border-color: #2563eb; }
    button.primary:hover { background: #1d4ed8; }
    button.icon { padding: 2px 8px; }
    details { background: #1c1f27; border-radius: 8px; padding: 6px 8px; }
    summary { cursor: pointer; font-weight: 600; }
    form, .settings { display: grid; gap: 8px; margin-top: 8px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    label { display: grid; gap: 3px; color: #9aa1b2; font-size: 12px; }
    label.radio { display: flex; align-items: center; gap: 6px; color: #e8eaf0; font-size: 13px; }
    input { font: inherit; color: #e8eaf0; background: #0f1116; border: 1px solid #3a4050; border-radius: 6px; padding: 5px 7px; width: 100%; }
    input[type=radio] { width: auto; }
    pre { white-space: pre-wrap; margin: 0; color: #9aa1b2; font-size: 12px; }
    pre:empty { display: none; }
    .log { display: grid; gap: 2px; margin-top: 8px; font-size: 12px; }
    .log-row { display: flex; justify-content: space-between; gap: 8px; }
  `;

  const TEMPLATE = `
    <div class="panel">
      <div class="head"><strong>FC Snipe Helper</strong><button class="icon" data-act="toggle" title="Ein-/Ausklappen">–</button></div>
      <div class="body">
        <div class="status" id="status"></div>
        <div class="msg" id="msg"></div>
        <div id="targets"></div>
        <details id="add-box">
          <summary>Spieler hinzufügen</summary>
          <form id="add-form">
            <label>Name<input name="player" required placeholder="z. B. Mbappé"></label>
            <div class="row">
              <label>Verkaufspreis<input name="sell" inputmode="numeric" placeholder="z. B. 25000"></label>
              <label>Wunschgewinn<input name="profit" inputmode="numeric" placeholder="z. B. 1000"></label>
            </div>
            <div class="row">
              <label>Max. Kaufpreis<input name="maxBuy" inputmode="numeric" placeholder="automatisch"></label>
              <label>Anzahl<input name="wanted" type="number" min="1" value="1"></label>
            </div>
            <button type="submit" class="primary">Hinzufügen</button>
          </form>
        </details>
        <details>
          <summary>Einstellungen</summary>
          <div class="settings">
            <label class="radio"><input type="radio" name="bumpMode" value="empty"> Min. Sofortkauf erhöhen, wenn nichts gefunden</label>
            <label class="radio"><input type="radio" name="bumpMode" value="always"> nach jeder Suche erhöhen</label>
            <label>Erhöhungen, bevor er wieder bei leer anfängt<input name="cycleSteps" type="number" min="1" max="50"></label>
            <button data-act="diagnose">Diagnose</button>
            <pre id="diag"></pre>
          </div>
        </details>
        <details>
          <summary>Verlauf</summary>
          <div id="log"></div>
        </details>
      </div>
    </div>
  `;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function signed(n) {
    return `<span class="${n >= 0 ? 'pos' : 'neg'}">${n >= 0 ? '+' : ''}${fmt(n)}</span>`;
  }

  function notify(text) {
    if (root) root.getElementById('msg').textContent = text;
  }

  function renderStatus() {
    const el = root && root.getElementById('status');
    if (!el) return;
    const t = activeTarget();
    const now = Date.now();
    const lastHour = session.searchTimes.filter((x) => now - x < 3600000).length;
    const lines = [
      t ? `Aktiv: <strong>${escapeHtml(t.name)}</strong> · max. ${fmt(t.maxBuy)}` : '<span class="muted">Kein Spieler aktiv – bei einem Spieler auf „Filter“ klicken.</span>',
      `<span class="muted">Mindestpreis-Zyklus ${data.bumps}/${data.settings.cycleSteps} · Suchen (60 Min): ${lastHour} · davon leer: ${session.emptyCount}</span>`,
    ];
    if (session.cheapest) {
      lines.push(`Günstigster Treffer: ${fmt(session.cheapest)}${t && t.sellPrice ? ` (${signed(profitOf(session.cheapest, t.sellPrice))})` : ''}`);
    }
    el.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }

  function renderTargets() {
    const el = root.getElementById('targets');
    if (!data.targets.length) {
      el.innerHTML = '<div class="muted">Noch keine Spieler – unten unter „Spieler hinzufügen“ anlegen.</div>';
      return;
    }
    el.innerHTML = data.targets
      .map((t) => {
        const done = t.bought >= t.wanted;
        const meta = [`max. ${fmt(t.maxBuy)}`];
        if (t.sellPrice) meta.push(`VK ${fmt(t.sellPrice)}`, `${signed(profitOf(t.maxBuy, t.sellPrice))}/Stk`);
        return `
          <div class="target${t.id === data.activeId ? ' active' : ''}${done ? ' done' : ''}">
            <div><div class="t-name">${escapeHtml(t.name)}</div><div class="muted">${meta.join(' · ')}</div></div>
            <div class="t-count">${t.bought}/${t.wanted}</div>
            <div class="t-actions">
              <button class="primary" data-act="use" data-id="${t.id}">Filter</button>
              <button data-act="buy" data-id="${t.id}">+1 Kauf</button>
              <button data-act="sell" data-id="${t.id}">Verkauft</button>
              <button class="icon" data-act="remove" data-id="${t.id}" title="Entfernen">✕</button>
            </div>
          </div>`;
      })
      .join('');
  }

  function renderLog() {
    const el = root.getElementById('log');
    const spent = data.log.filter((e) => e.type === 'buy').reduce((s, e) => s + e.price, 0);
    const income = data.log.filter((e) => e.type === 'sell').reduce((s, e) => s + afterTax(e.price), 0);
    const rows = data.log
      .slice(-30)
      .reverse()
      .map((e) => {
        const time = new Date(e.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const label = e.type === 'buy' ? 'Kauf' : 'Verkauf';
        return `<div class="log-row"><span>${time} · ${label} · ${escapeHtml(e.name)}</span><span>${fmt(e.price)}</span></div>`;
      })
      .join('');
    el.innerHTML = `
      <div class="log">
        <div class="log-row"><span>Ausgegeben</span><span>${fmt(spent)}</span></div>
        <div class="log-row"><span>Einnahmen (nach Steuer)</span><span>${fmt(income)}</span></div>
        <div class="log-row"><strong>Bilanz</strong>${signed(income - spent)}</div>
        ${rows || '<div class="muted">Noch keine Einträge.</div>'}
        ${rows ? '<div><button data-act="clear-log">Verlauf löschen</button></div>' : ''}
      </div>`;
  }

  function render() {
    root.querySelector('.panel').classList.toggle('collapsed', !!data.collapsed);
    root.querySelector('[data-act="toggle"]').textContent = data.collapsed ? '+' : '–';
    renderStatus();
    renderTargets();
    renderLog();
  }

  function askPrice(label, fallback) {
    const raw = window.prompt(label, fallback ? String(fallback) : '');
    return raw === null ? 0 : parseCoins(raw);
  }

  function diagnose() {
    const view = filtersView();
    const lines = [
      `Suchseite sichtbar: ${view ? 'ja' : 'nein'}`,
      `Spielername-Feld: ${view && $(SELECTORS.playerName, view) ? 'gefunden' : 'fehlt'}`,
      `Preisfelder: ${view ? $$(SELECTORS.priceInputs, view).length : 0} von 4`,
      `Such-Button: ${view && $(SELECTORS.searchButton, view) ? 'gefunden' : 'fehlt'}`,
      `Ergebnis-Karten sichtbar: ${$$(SELECTORS.resultItem).filter(isVisible).length}`,
      `„Keine Ergebnisse“ sichtbar: ${$$(SELECTORS.noResults).some(isVisible) ? 'ja' : 'nein'}`,
    ];
    if (!view) lines.push('', 'Für den vollen Test: Transfers → Transfermarkt durchsuchen öffnen und erneut klicken.');
    root.getElementById('diag').textContent = lines.join('\n');
  }

  function onPanelClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const target = data.targets.find((t) => t.id === btn.dataset.id);
    switch (btn.dataset.act) {
      case 'toggle':
        data.collapsed = !data.collapsed;
        break;
      case 'use':
        data.activeId = target.id;
        fillFilters(target);
        break;
      case 'buy': {
        const price = askPrice(`Kaufpreis für ${target.name}:`, session.cheapest || target.maxBuy);
        if (!price) return;
        target.bought++;
        data.log.push({ t: Date.now(), name: target.name, type: 'buy', price });
        if (target.bought >= target.wanted) notify(`${target.name}: Ziel erreicht (${target.bought}/${target.wanted}).`);
        break;
      }
      case 'sell': {
        const price = askPrice(`Verkaufspreis für ${target.name}:`, target.sellPrice);
        if (!price) return;
        data.log.push({ t: Date.now(), name: target.name, type: 'sell', price });
        break;
      }
      case 'remove':
        if (!window.confirm(`${target.name} aus der Liste entfernen?`)) return;
        data.targets = data.targets.filter((t) => t !== target);
        if (data.activeId === target.id) data.activeId = null;
        break;
      case 'clear-log':
        if (!window.confirm('Verlauf wirklich löschen?')) return;
        data.log = [];
        break;
      case 'diagnose':
        diagnose();
        return;
    }
    save();
    render();
  }

  function updateMaxBuyPlaceholder(form) {
    const sell = parseCoins(form.sell.value);
    const auto = sell ? maxBuyFor(sell, parseCoins(form.profit.value)) : 0;
    form.maxBuy.placeholder = auto ? `automatisch: ${fmt(auto)}` : 'automatisch';
  }

  function onAdd(e) {
    e.preventDefault();
    const form = e.target;
    const sellPrice = parseCoins(form.sell.value);
    const maxBuy = floorToValid(parseCoins(form.maxBuy.value)) || (sellPrice ? maxBuyFor(sellPrice, parseCoins(form.profit.value)) : 0);
    if (!maxBuy) return notify('Gib einen Max. Kaufpreis oder einen Verkaufspreis an (mind. 200).');
    data.targets.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: form.player.value.trim(),
      maxBuy,
      sellPrice,
      wanted: Math.max(1, parseInt(form.wanted.value, 10) || 1),
      bought: 0,
    });
    form.reset();
    updateMaxBuyPlaceholder(form);
    notify('');
    save();
    render();
  }

  function onPanelInput(e) {
    const form = e.target.form;
    if (form && form.id === 'add-form') updateMaxBuyPlaceholder(form);
  }

  function onPanelChange(e) {
    const el = e.target;
    if (el.name === 'bumpMode') data.settings.bumpMode = el.value;
    else if (el.name === 'cycleSteps') {
      data.settings.cycleSteps = Math.min(50, Math.max(1, parseInt(el.value, 10) || 10));
      el.value = data.settings.cycleSteps;
    } else return;
    save();
    renderStatus();
  }

  // Constructable Stylesheets greifen auch, wenn die Seite Inline-<style> per CSP blockiert.
  function applyStyles(shadow) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.prepend(style);
    }
  }

  // Die Web App baut ihre Seite beim Start neu auf und kann das Overlay dabei entfernen.
  function attachHost() {
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
  }

  function mountPanel() {
    host = document.createElement('div');
    host.id = 'fc-snipe-helper';
    host.style.cssText = 'position:fixed;top:72px;right:12px;z-index:2147483000;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    applyStyles(root);
    root.querySelector(`input[name="bumpMode"][value="${data.settings.bumpMode}"]`).checked = true;
    root.querySelector('input[name="cycleSteps"]').value = data.settings.cycleSteps;
    root.addEventListener('click', onPanelClick);
    root.addEventListener('submit', onAdd);
    root.addEventListener('input', onPanelInput);
    root.addEventListener('change', onPanelChange);
    // Tastatureingaben im Overlay nicht an die Web App weiterreichen
    for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, (e) => e.stopPropagation());
    attachHost();
    render();
  }

  function init() {
    console.info('[FC Snipe Helper] geladen auf', location.href);
    try {
      data = load();
      mountPanel();
      watchWebApp();
      scan();
    } catch (e) {
      console.error('[FC Snipe Helper] Start fehlgeschlagen:', e);
    }
  }

  init();
})();
