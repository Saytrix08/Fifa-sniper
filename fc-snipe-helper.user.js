// ==UserScript==
// @name         FC Snipe Helper
// @namespace    https://github.com/Saytrix08/Fifa-sniper
// @version      0.3.0
// @description  Overlay für die EA FC Web App: Snipe-Liste, Suchfilter per Klick ausfüllen, Mindest-Sofortkaufpreis automatisch hochsetzen, Pfeiltasten für Zurück/Suchen, Gewinn nach Steuer. Jede Suche und jeden Kauf löst du selbst aus.
// @match        https://*.ea.com/*web-app*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
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
    backButton: '.ut-navigation-button-control',
  };
  const PRICE = { minBid: 0, maxBid: 1, minBin: 2, maxBin: 3 };

  const STORE_KEY = 'fcSnipeHelper.v1';
  const DEFAULTS = {
    targets: [],
    activeId: null,
    bumps: 0,
    log: [],
    collapsed: false,
    settings: { bumpMode: 'empty', cycleSteps: 10, hotkeys: true },
  };

  let data;
  let root;
  let host;
  const session = {
    searchPending: false,
    lastResult: null,
    filtersVisible: false,
    searchMinBin: null,
    searchMaxBin: 0,
    lastOutcome: null,
    pendingMinBin: null,
    cheapest: 0,
    searchTimes: [],
    emptyCount: 0,
  };

  function load() {
    const base = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const saved = JSON.parse(GM_getValue(STORE_KEY, 'null'));
      if (saved) return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
    } catch (e) {
      // Speicher kaputt oder blockiert → Standardwerte
    }
    return base;
  }

  function save() {
    try {
      GM_setValue(STORE_KEY, JSON.stringify(data));
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
    session.searchMinBin = null;
    save();
    const name = $(SELECTORS.playerName, view);
    if (!name) return notify('Max. Sofortkauf gesetzt, Namensfeld nicht gefunden – Spieler bitte selbst eintippen.');
    setInputValue(name, target.name, true);
    notify(`Max. Sofortkauf ${fmt(target.maxBuy)} gesetzt – jetzt die richtige Karte in der Vorschlagsliste wählen.`);
  }

  function priceInputs(view) {
    const prices = view ? $$(SELECTORS.priceInputs, view) : [];
    return prices.length >= 4 ? prices : null;
  }

  // Trägt den vorgemerkten Mindest-Sofortkaufpreis ein, sobald die Preisfelder
  // im DOM sind – auch während die Suchseite hinter den Ergebnissen versteckt ist.
  function applyPendingMinBin(view) {
    const prices = priceInputs(view);
    if (session.pendingMinBin == null || !prices) return;
    const minEl = prices[PRICE.minBin];
    if (parseCoins(minEl.value) !== session.pendingMinBin) {
      setInputValue(minEl, session.pendingMinBin ? String(session.pendingMinBin) : '');
    }
  }

  // Steht der Mindestpreis noch auf dem Wert der letzten Suche, wird er direkt
  // vor der neuen Suche eine Stufe weitergesetzt. Das greift auch, wenn die
  // Seite „Keine Ergebnisse“ anders anzeigt, als das Script erwartet.
  function ensureFreshMinBin(prices) {
    if (!prices || session.searchMinBin == null) return;
    if (data.settings.bumpMode === 'empty' && session.lastOutcome === 'found') return;
    const minEl = prices[PRICE.minBin];
    const current = parseCoins(minEl.value);
    if (current !== session.searchMinBin) return;
    const next = nextMinBin(current, parseCoins(prices[PRICE.maxBin].value), data.bumps, data.settings.cycleSteps);
    data.bumps = next.bumps;
    save();
    setInputValue(minEl, next.value ? String(next.value) : '');
  }

  // ---------------------------------------------------------------------------
  // Beobachten, was in der Web App passiert
  // ---------------------------------------------------------------------------

  function onSearchClicked(view) {
    const now = Date.now();
    const prices = priceInputs(view);
    session.searchMinBin = prices ? parseCoins(prices[PRICE.minBin].value) : 0;
    session.searchMaxBin = prices ? parseCoins(prices[PRICE.maxBin].value) : 0;
    session.pendingMinBin = null;
    session.searchPending = true;
    session.lastResult = null;
    session.lastOutcome = null;
    session.cheapest = 0;
    session.searchTimes = session.searchTimes.filter((t) => now - t < 3600000);
    session.searchTimes.push(now);
    renderStatus();
  }

  function finishSearch(kind) {
    session.searchPending = false;
    session.lastResult = kind;
    session.lastOutcome = kind;
    if (kind === 'empty') session.emptyCount++;
    if (data.settings.bumpMode === 'always' || kind === 'empty') {
      const next = nextMinBin(session.searchMinBin, session.searchMaxBin, data.bumps, data.settings.cycleSteps);
      data.bumps = next.bumps;
      session.pendingMinBin = next.value;
      save();
      applyPendingMinBin($(SELECTORS.filtersView));
      notify(next.value ? `Nächste Suche: Min. Sofortkauf ${fmt(next.value)}` : 'Nächste Suche: Min. Sofortkauf leer');
    }
    renderStatus();
  }

  function scan() {
    const view = filtersView();
    const visible = !!view;
    if (session.searchPending) {
      if ($$(SELECTORS.noResults).some(isVisible)) finishSearch('empty');
      else if (!visible && $$(SELECTORS.resultItem).some(isVisible)) finishSearch('found');
    }
    if (session.lastResult === 'found' && !visible) annotateResults();
    // Zurück auf der Suchseite: Falls die Web App die Felder neu aufgebaut hat,
    // den vorgemerkten Mindestpreis sofort und kurz darauf noch einmal eintragen.
    if (visible && !session.filtersVisible) {
      session.lastResult = null;
      if (session.pendingMinBin != null) {
        applyPendingMinBin(view);
        setTimeout(() => {
          applyPendingMinBin(filtersView());
          session.pendingMinBin = null;
        }, 400);
      }
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
    const sign = profit >= 0 ? 'pos' : 'neg';
    if (badge.dataset.sign !== sign) {
      badge.dataset.sign = sign;
      badge.style.background = sign === 'pos' ? '#1f9d55' : '#c53030';
    }
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
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      // Die Web App blendet Seiten teils nur per Klasse/Style ein und aus
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });

    document.addEventListener(
      'pointerup',
      (e) => {
        const el = e.target instanceof Element ? e.target : null;
        if (!el) return;
        const view = filtersView();
        const btn = el.closest(SELECTORS.searchButton);
        // Nur echte Klicks – die Pfeiltaste meldet ihre Suche selbst an
        if (btn && view && view.contains(btn)) {
          if (!e.isTrusted) return;
          ensureFreshMinBin(priceInputs(view));
          onSearchClicked(view);
        } else if (el.closest(SELECTORS.navTab)) {
          session.searchPending = false;
          session.lastResult = null;
        }
      },
      true
    );

    document.addEventListener('keydown', onHotkey, true);
  }

  // ---------------------------------------------------------------------------
  // Pfeiltasten: ← zurück, → suchen. Ein Tastendruck = eine Aktion; gedrückt
  // halten wiederholt nichts.
  // ---------------------------------------------------------------------------

  const HOTKEY_GAP_MS = 300;
  let lastHotkey = 0;

  function findButton(scope, selector, textPattern) {
    const direct = $$(selector, scope).find(isVisible);
    if (direct || !textPattern) return direct || null;
    return $$('button', scope).find((b) => isVisible(b) && textPattern.test(b.textContent.trim())) || null;
  }

  function pressButton(el) {
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ctor = type.startsWith('pointer') ? Pointer : MouseEvent;
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, button: 0, buttons: type.endsWith('down') ? 1 : 0 }));
    }
  }

  function hotkeySearch(view) {
    const btn = findButton(view, SELECTORS.searchButton, /^(suchen|search)$/i);
    if (!btn) {
      notify('Such-Button nicht gefunden – bitte „Seitenaufbau kopieren“ und an Claude schicken.');
      return false;
    }
    const prices = priceInputs(view);
    ensureFreshMinBin(prices);
    onSearchClicked(view);
    pressButton(btn);
    if (prices) {
      const min = parseCoins(prices[PRICE.minBin].value);
      notify(`Suche · Min. Sofortkauf ${min ? fmt(min) : 'leer'}`);
    }
    return true;
  }

  function hotkeyBack() {
    const btn = findButton(document, SELECTORS.backButton);
    if (!btn) {
      notify('Zurück-Button nicht gefunden – bitte „Seitenaufbau kopieren“ und an Claude schicken.');
      return false;
    }
    pressButton(btn);
    return true;
  }

  function onHotkey(e) {
    if (!data.settings.hotkeys || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const view = filtersView();
    // Im Overlay und beim Tippen in Textfeldern Pfeiltasten normal lassen –
    // außer in den Preisfeldern der Suche.
    const path = e.composedPath();
    if (host && path.includes(host)) return;
    const origin = path[0];
    const prices = priceInputs(view) || [];
    const editable = origin instanceof Element && origin.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    if (editable && !prices.includes(origin)) return;
    const now = Date.now();
    if (now - lastHotkey < HOTKEY_GAP_MS) {
      e.preventDefault();
      return;
    }
    let handled = false;
    if (e.key === 'ArrowRight' && view) handled = hotkeySearch(view);
    else if (e.key === 'ArrowLeft' && !view) handled = hotkeyBack();
    if (handled) {
      lastHotkey = now;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // Sichtbaren Seitenaufbau (Tags, Klassen, kurze Texte) zum Einschicken
  function snapshotPage() {
    const lines = [];
    const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg', 'SVG', 'TEMPLATE']);
    const walk = (el, depth) => {
      if (lines.length >= 600 || el === host || skip.has(el.tagName) || !isVisible(el)) return;
      let line = '  '.repeat(depth) + el.tagName.toLowerCase();
      if (el.classList.length) line += '.' + Array.from(el.classList).join('.');
      if (el.tagName === 'INPUT') line += ` [type=${el.type}${el.placeholder ? ` placeholder="${el.placeholder}"` : ''}${el.value ? ` value="${el.value}"` : ''}]`;
      if (el.tagName === 'BUTTON' || el.children.length === 0) {
        const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
        if (text) line += ` "${text}"`;
      }
      lines.push(line);
      for (const child of el.children) walk(child, depth + 1);
    };
    walk(document.body, 0);
    return `FC Snipe Helper ${typeof GM_info === 'object' ? GM_info.script.version : ''} · ${location.pathname}\n` + lines.join('\n');
  }

  function copySnapshot() {
    const text = snapshotPage();
    root.getElementById('diag').textContent = text;
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(text, 'text');
      else navigator.clipboard.writeText(text);
      notify(`Seitenaufbau kopiert (${text.split('\n').length} Zeilen) – jetzt im Chat mit Strg+V einfügen.`);
    } catch (err) {
      notify('Kopieren fehlgeschlagen – Text unten markieren und kopieren.');
    }
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
    pre { white-space: pre-wrap; margin: 0; color: #9aa1b2; font-size: 12px; max-height: 220px; overflow: auto; user-select: text; }
    .buttons { display: flex; gap: 6px; flex-wrap: wrap; }
    pre:empty { display: none; }
    .log { display: grid; gap: 2px; margin-top: 8px; font-size: 12px; }
    .log-row { display: flex; justify-content: space-between; gap: 8px; }
  `;

  // Kleiner DOM-Baukasten statt innerHTML: Seiten mit Trusted Types lassen
  // innerHTML-Zuweisungen mit einem Fehler abbrechen.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value == null) continue;
      el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === false || child == null) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  function buildPanel() {
    const field = (label, attrs) => h('label', null, label, h('input', attrs));
    return h('div', { class: 'panel' },
      h('div', { class: 'head' },
        h('strong', null, 'FC Snipe Helper'),
        h('button', { class: 'icon', 'data-act': 'toggle', title: 'Ein-/Ausklappen' }, '–')),
      h('div', { class: 'body' },
        h('div', { class: 'status', id: 'status' }),
        h('div', { class: 'msg', id: 'msg' }),
        h('div', { id: 'targets' }),
        h('details', null,
          h('summary', null, 'Spieler hinzufügen'),
          h('form', { id: 'add-form' },
            field('Name', { name: 'player', required: true, placeholder: 'z. B. Mbappé' }),
            h('div', { class: 'row' },
              field('Verkaufspreis', { name: 'sell', inputmode: 'numeric', placeholder: 'z. B. 25000' }),
              field('Wunschgewinn', { name: 'profit', inputmode: 'numeric', placeholder: 'z. B. 1000' })),
            h('div', { class: 'row' },
              field('Max. Kaufpreis', { name: 'maxBuy', inputmode: 'numeric', placeholder: 'automatisch' }),
              field('Anzahl', { name: 'wanted', type: 'number', min: 1, value: 1 })),
            h('button', { type: 'submit', class: 'primary' }, 'Hinzufügen'))),
        h('details', null,
          h('summary', null, 'Einstellungen'),
          h('div', { class: 'settings' },
            h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'bumpMode', value: 'empty' }), 'Min. Sofortkauf erhöhen, wenn nichts gefunden'),
            h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'bumpMode', value: 'always' }), 'nach jeder Suche erhöhen'),
            field('Erhöhungen, bevor er wieder bei leer anfängt', { name: 'cycleSteps', type: 'number', min: 1, max: 50 }),
            h('label', { class: 'radio' }, h('input', { type: 'checkbox', name: 'hotkeys' }), 'Pfeiltasten: ← zurück, → suchen'),
            h('div', { class: 'buttons' },
              h('button', { 'data-act': 'diagnose' }, 'Diagnose'),
              h('button', { 'data-act': 'snapshot' }, 'Seitenaufbau kopieren')),
            h('pre', { id: 'diag' }))),
        h('details', null,
          h('summary', null, 'Verlauf'),
          h('div', { id: 'log' }))));
  }

  function signed(n) {
    return h('span', { class: n >= 0 ? 'pos' : 'neg' }, `${n >= 0 ? '+' : ''}${fmt(n)}`);
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
    el.replaceChildren(
      t
        ? h('div', null, 'Aktiv: ', h('strong', null, t.name), ` · max. ${fmt(t.maxBuy)}`)
        : h('div', { class: 'muted' }, 'Kein Spieler aktiv – bei einem Spieler auf „Filter“ klicken.'),
      h('div', { class: 'muted' }, `Mindestpreis-Zyklus ${data.bumps}/${data.settings.cycleSteps} · Suchen (60 Min): ${lastHour} · davon leer: ${session.emptyCount}`),
      session.cheapest
        ? h('div', null, `Günstigster Treffer: ${fmt(session.cheapest)}`, t && t.sellPrice ? [' (', signed(profitOf(session.cheapest, t.sellPrice)), ')'] : null)
        : ''
    );
  }

  function renderTargets() {
    const el = root.getElementById('targets');
    if (!data.targets.length) {
      el.replaceChildren(h('div', { class: 'muted' }, 'Noch keine Spieler – unten unter „Spieler hinzufügen“ anlegen.'));
      return;
    }
    el.replaceChildren(
      ...data.targets.map((t) => {
        const meta = [`max. ${fmt(t.maxBuy)}`];
        if (t.sellPrice) meta.push(` · VK ${fmt(t.sellPrice)} · `, signed(profitOf(t.maxBuy, t.sellPrice)), '/Stk');
        const cls = ['target', t.id === data.activeId && 'active', t.bought >= t.wanted && 'done'].filter(Boolean).join(' ');
        const btn = (act, label, extra) => h('button', { 'data-act': act, 'data-id': t.id, ...extra }, label);
        return h('div', { class: cls },
          h('div', null, h('div', { class: 't-name' }, t.name), h('div', { class: 'muted' }, meta)),
          h('div', { class: 't-count' }, `${t.bought}/${t.wanted}`),
          h('div', { class: 't-actions' },
            btn('use', 'Filter', { class: 'primary' }),
            btn('buy', '+1 Kauf'),
            btn('sell', 'Verkauft'),
            btn('remove', '✕', { class: 'icon', title: 'Entfernen' })));
      })
    );
  }

  function renderLog() {
    const el = root.getElementById('log');
    const spent = data.log.filter((e) => e.type === 'buy').reduce((s, e) => s + e.price, 0);
    const income = data.log.filter((e) => e.type === 'sell').reduce((s, e) => s + afterTax(e.price), 0);
    const row = (left, right) => h('div', { class: 'log-row' }, left, right);
    const rows = data.log
      .slice(-30)
      .reverse()
      .map((e) => {
        const time = new Date(e.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return row(h('span', null, `${time} · ${e.type === 'buy' ? 'Kauf' : 'Verkauf'} · ${e.name}`), h('span', null, fmt(e.price)));
      });
    el.replaceChildren(
      h('div', { class: 'log' },
        row(h('span', null, 'Ausgegeben'), h('span', null, fmt(spent))),
        row(h('span', null, 'Einnahmen (nach Steuer)'), h('span', null, fmt(income))),
        row(h('strong', null, 'Bilanz'), signed(income - spent)),
        rows.length ? rows : h('div', { class: 'muted' }, 'Noch keine Einträge.'),
        rows.length ? h('div', null, h('button', { 'data-act': 'clear-log' }, 'Verlauf löschen')) : null)
    );
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
      `Zurück-Button: ${$$(SELECTORS.backButton).some(isVisible) ? 'gefunden' : 'fehlt'}`,
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
      case 'snapshot':
        copySnapshot();
        return;
    }
    save();
    render();
  }

  function updateMaxBuyPlaceholder(form) {
    const f = form.elements;
    const sell = parseCoins(f.namedItem('sell').value);
    const auto = sell ? maxBuyFor(sell, parseCoins(f.namedItem('profit').value)) : 0;
    f.namedItem('maxBuy').placeholder = auto ? `automatisch: ${fmt(auto)}` : 'automatisch';
  }

  function onAdd(e) {
    e.preventDefault();
    const form = e.target;
    const f = form.elements;
    const sellPrice = parseCoins(f.namedItem('sell').value);
    const maxBuy =
      floorToValid(parseCoins(f.namedItem('maxBuy').value)) ||
      (sellPrice ? maxBuyFor(sellPrice, parseCoins(f.namedItem('profit').value)) : 0);
    if (!maxBuy) return notify('Gib einen Max. Kaufpreis oder einen Verkaufspreis an (mind. 200).');
    data.targets.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: f.namedItem('player').value.trim(),
      maxBuy,
      sellPrice,
      wanted: Math.max(1, parseInt(f.namedItem('wanted').value, 10) || 1),
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
    else if (el.name === 'hotkeys') data.settings.hotkeys = el.checked;
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
    host.style.cssText = 'position:fixed;top:72px;right:12px;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    applyStyles(root);
    root.append(buildPanel());
    root.querySelector(`input[name="bumpMode"][value="${data.settings.bumpMode}"]`).checked = true;
    root.querySelector('input[name="cycleSteps"]').value = data.settings.cycleSteps;
    root.querySelector('input[name="hotkeys"]').checked = !!data.settings.hotkeys;
    root.addEventListener('click', onPanelClick);
    root.addEventListener('submit', onAdd);
    root.addEventListener('input', onPanelInput);
    root.addEventListener('change', onPanelChange);
    // Tastatureingaben im Overlay nicht an die Web App weiterreichen
    for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, (e) => e.stopPropagation());
    attachHost();
    render();
  }

  // Ohne Konsole sichtbar machen, warum das Overlay fehlt.
  function showError(err) {
    console.error('[FC Snipe Helper] Start fehlgeschlagen:', err);
    const box = document.createElement('div');
    box.textContent = `FC Snipe Helper – Fehler beim Start: ${(err && err.message) || err}`;
    box.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:2147483647;max-width:380px;padding:10px 12px;border-radius:8px;' +
      'background:#c53030;color:#fff;font:13px/1.4 system-ui,sans-serif;';
    (document.body || document.documentElement).appendChild(box);
  }

  let startError = null;

  // Tampermonkey-Menü: Overlay zurückholen und Status anzeigen
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('Overlay anzeigen / Status', () => {
      if (startError) return window.alert(`FC Snipe Helper – Fehler beim Start:\n${startError.stack || startError}`);
      data.collapsed = false;
      save();
      attachHost();
      render();
      const r = host.getBoundingClientRect();
      window.alert(
        'FC Snipe Helper läuft.\n' +
          `Overlay im Dokument: ${host.isConnected ? 'ja' : 'nein'}\n` +
          `Position: ${Math.round(r.left)}, ${Math.round(r.top)} · Größe: ${Math.round(r.width)}×${Math.round(r.height)}\n` +
          `Fenster: ${window.innerWidth}×${window.innerHeight}\n` +
          `Adresse: ${location.href}`
      );
    });
  }

  function init() {
    console.info('[FC Snipe Helper] geladen auf', location.href);
    registerMenu();
    try {
      data = load();
      mountPanel();
      watchWebApp();
      scan();
    } catch (e) {
      startError = e;
      showError(e);
    }
  }

  init();
})();
