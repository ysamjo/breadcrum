// ==UserScript==
// @name         YouTube: Better Watch Later (nur Playlist)
// @namespace    https://github.com/Eloren1
// @version      2.7.9
// @description  Verbesserte Watch-Later-Ansicht: Karten-Ansicht, Sortieren, Filtern, alle Videos laden. (Breadcrum-Teil entfernt - uebernimmt die gleichnamige Firefox-Erweiterung.)
// @author       Eloren1 + zusammengeführt
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // SETTINGS, EDIT BY HAND
  const CONFIG = {
    REDIRECT_HOMEPAGE_TO_WATCH_LATER: true,
    REDIR_SUBSCRIPTNS_TO_WATCH_LATER: false,
    APPLY_ON_ALL_YOUR_PLAYLISTS: true, // if false, only applies to Watch Later
    CUSTOM_PLAYLIST_REDIRECT: '', // starting with "https://", default empty
    INCLUDE_PLAYLIST_VIEW: false, // if true, opening a video keeps the playlist sidebar
  };

  //
  //

  const WATCH_LATER_URL = 'https://www.youtube.com/playlist?list=WL';
  const REDIRECT_POLL_MS = 500;

  function redirectTarget() {
    const custom = (CONFIG.CUSTOM_PLAYLIST_REDIRECT || '').trim();
    return custom.startsWith('https://') ? custom : WATCH_LATER_URL;
  }

  function playlistId(url) {
    try {
      return new URL(url, location.origin).searchParams.get('list') || '';
    } catch {
      return '';
    }
  }

  function shouldEnhance() {
    if (!location.pathname.startsWith('/playlist')) return false;
    if (CONFIG.APPLY_ON_ALL_YOUR_PLAYLISTS) return true;
    const current = playlistId(location.href);
    return current === 'WL' || current === playlistId(redirectTarget());
  }

  function isRedirectSource() {
    const path = location.pathname;
    if (CONFIG.REDIRECT_HOMEPAGE_TO_WATCH_LATER && path === '/') return true;
    if (CONFIG.REDIR_SUBSCRIPTNS_TO_WATCH_LATER && path === '/feed/subscriptions') return true;
    return false;
  }

  function maybeRedirect() {
    if (!isRedirectSource()) return;
    const target = redirectTarget();
    if (location.href === target) return;
    location.replace(target);
  }

  function watchForRedirects() {
    if (!CONFIG.REDIRECT_HOMEPAGE_TO_WATCH_LATER && !CONFIG.REDIR_SUBSCRIPTNS_TO_WATCH_LATER) return;
    maybeRedirect();
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      maybeRedirect();
    }, REDIRECT_POLL_MS);
    window.addEventListener('yt-navigate-finish', maybeRedirect);
  }

  watchForRedirects();

  const LS_KEY = 'bywl:settings';

  // these properties should be changed in the toolbar, not here
  const DEFAULTS = {
    layout: 'grid', // grid | standard
    thumb: 100, // thumbnail scale
    sort: 'default', // default | duration-asc | duration-desc | title | channel
    filter: '', // substring match against title and channel
  };

  const BASE_CARD_PX = 240;
  const THUMB_MIN = 50;
  const THUMB_MAX = 200;
  const THUMB_STEP = 10;
  const ACTION_TIMEOUT = 4000;
  const LOAD_ALL_POLL_MS = 1000;
  const LOAD_ALL_IDLE_MS = 15000;
  const LOAD_ALL_MAX_MS = 10 * 60 * 1000;

  const settings = Object.assign({}, DEFAULTS, readSettings());
  delete settings.columns;
  delete settings.enabled;
  delete settings.showIndex;
  delete settings.wide;
  settings.thumb = clampThumb(settings.thumb);
  settings.layout = settings.layout === 'standard' ? 'standard' : 'grid';
  settings.sort = DEFAULTS.sort; // sorting is per-session, never restored

  function clampThumb(value) {
    return Math.min(THUMB_MAX, Math.max(THUMB_MIN, Number(value) || DEFAULTS.thumb));
  }

  const MENU_MATCHERS = {
    remove: [/remove from/i, /удалить из/i, /убрать из/i],
    queue: [/add to queue/i, /добавить в очередь/i, /в очередь/i],
  };

  const CARD = 'ytd-playlist-video-renderer';
  const LIST = 'ytd-playlist-video-list-renderer #contents';

  const HEADER_ROOTS = [
    'ytd-playlist-header-renderer',
    'ytd-playlist-sidebar-renderer',
    'ytd-tabbed-page-header',
    'ytd-browse[page-subtype="playlist"] #page-header',
  ];
  const SHUFFLE_IN_HEADER = 'a[aria-label="Shuffle" i], button[aria-label="Shuffle" i]';
  const COUNT_RE = /([\d][\d.,\s]*)\s*(videos?|видео)/i;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveSettings() {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }

  function waitFor(fn, timeout = ACTION_TIMEOUT, interval = 60) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function poll() {
        let value;
        try {
          value = fn();
        } catch (err) {
          return reject(err);
        }
        if (value) return resolve(value);
        if (Date.now() - started > timeout) return reject(new Error('timed out'));
        setTimeout(poll, interval);
      })();
    });
  }

  let chain = Promise.resolve();
  function serial(task) {
    const run = () => task();
    const next = chain.then(run, run);
    chain = next.catch(() => {});
    return next;
  }

  function cardData(card) {
    const link = $('a#video-title', card);
    const href = link?.href || '';
    const id = href ? new URL(href, location.origin).searchParams.get('v') || '' : '';

    // Robusterer Zugriff auf die Laufzeit, um auch verzögert geladene Elemente zu erfassen
    const durationText =
      $('ytd-thumbnail-overlay-time-status-renderer', card)?.textContent ||
      $('badge-shape', card)?.textContent ||
      '';

    return {
      id,
      href,
      watchUrl: id ? `https://www.youtube.com/watch?v=${id}` : href,
      title: link?.getAttribute('title') || link?.textContent.trim() || '',
      channel: $('ytd-channel-name #text a', card)?.textContent.trim() || '',
      durationText,
      durationSec: parseDuration(durationText),
    };
  }

  function openUrl(card) {
    const meta = cardData(card);
    if (CONFIG.INCLUDE_PLAYLIST_VIEW) return meta.href || meta.watchUrl;
    return meta.watchUrl;
  }

  function navigate(card) {
    const url = card.dataset.bywlUrl || openUrl(card);
    if (!url) return;
    if (CONFIG.INCLUDE_PLAYLIST_VIEW) {
      const link = $('a#video-title', card);
      if (link) return link.click();
    }
    location.assign(url);
  }

  function parseDuration(text) {
    if (!text) return 0;
    const match = text.match(/\d+(?::\d+)+/);
    if (!match) return 0;

    const parts = match[0].split(':').map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  function openDropdown() {
    return $$('tp-yt-iron-dropdown').find((dd) => {
      if (dd.getAttribute('aria-hidden') === 'true') return false;
      const rect = dd.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function closeDropdown() {
    const dd = openDropdown();
    if (!dd) return;
    if (typeof dd.close === 'function') dd.close();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
    );
  }

  function findMenuItem(matchers) {
    const dd = openDropdown();
    if (!dd) return null;
    const items = $$(
      'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, yt-list-item-view-model, tp-yt-paper-item',
      dd
    );
    const hit = items.find((item) => {
      const text = item.textContent.replace(/\s+/g, ' ').trim();
      return text && matchers.some((rx) => rx.test(text));
    });
    if (!hit) return null;
    return hit.matches('tp-yt-paper-item') ? hit : $('tp-yt-paper-item', hit) || hit;
  }

  function runMenuAction(card, matchers) {
    return serial(async () => {
      const trigger =
        $('#menu ytd-menu-renderer yt-icon-button#button', card) ||
        $('#menu ytd-menu-renderer button', card);
      if (!trigger) throw new Error('action menu button not found on card');

      document.documentElement.classList.add('bywl-acting');
      try {
        closeDropdown();
        await sleep(50);
        trigger.click();

        const item = await waitFor(() => findMenuItem(matchers));
        item.click();
        await sleep(150);
        closeDropdown();
      } finally {
        document.documentElement.classList.remove('bywl-acting');
      }
    });
  }

  let toastEl;
  function toast(message, isError = false) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'bywl-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.toggle('bywl-toast--error', isError);
    toastEl.classList.add('bywl-toast--on');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('bywl-toast--on'), 2200);
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const ICON_PATHS = {
    queue: 'M2 6h13v2H2V6zm0 5h13v2H2v-2zm0 5h9v2H2v-2zm16-6h2v4h4v2h-4v4h-2v-4h-4v-2h4v-4z',
    play: 'M8 5v14l11-7z',
    remove: 'M9 3h6l1 2h4v2H4V5h4l1-2zM6 9h12l-1 12H7L6 9zm4 2v8h1v-8h-1zm3 0v8h1v-8h-1z',
    shuffle:
      'M17 3v2h1.6l-4.3 4.3 1.4 1.4L20 6.4V8h2V3h-5zM3 5v2h3.7l3.6 3.6 1.4-1.4L7.5 5H3zm11.3 8.3-1.4 1.4 3.7 3.7H15v2h5v-5h-2v1.6l-3.7-3.7zM6.7 17H3v2h4.5l3.8-3.8-1.4-1.4L6.7 17z',
  };

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.appendChild(path);
    return svg;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) node.appendChild(child);
    return node;
  }

  const BUTTONS = [
    {
      key: 'queue',
      title: 'Add to queue',
      run: async (card) => {
        await runMenuAction(card, MENU_MATCHERS.queue);
        toast('Added to queue');
      },
    },
    {
      key: 'play',
      title: 'Play',
      primary: true,
      middleOpen: true,
      run: (card) => navigate(card),
    },
    {
      key: 'remove',
      title: 'Remove from playlist',
      danger: true,
      run: async (card) => {
        card.classList.add('bywl-card--busy');
        try {
          await runMenuAction(card, MENU_MATCHERS.remove);
          bumpTotal(-1);
        } finally {
          card.classList.remove('bywl-card--busy');
        }
      },
    },
  ];

  function decorate(card) {
    const meta = cardData(card);

    if (card.dataset.bywl === '1' && card.dataset.bywlDuration && card.dataset.bywlDuration !== '0') {
      return;
    }

    card.dataset.bywl = '1';
    card.dataset.bywlTitle = meta.title.toLowerCase();
    card.dataset.bywlChannel = meta.channel.toLowerCase();
    card.dataset.bywlDuration = String(meta.durationSec);
    card.dataset.bywlUrl = CONFIG.INCLUDE_PLAYLIST_VIEW ? meta.href || meta.watchUrl : meta.watchUrl;
  }

  let hoverEl = null;
  let hoverCard = null;

  function buildHoverOverlay() {
    if (hoverEl) return hoverEl;

    hoverEl = document.createElement('a');
    hoverEl.className = 'bywl-hover';

    hoverEl.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (event.target.closest('.bywl-btn')) return;
      const card = hoverCard;
      if (!card) return;
      event.preventDefault();
      navigate(card);
    });

    for (const def of BUTTONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'bywl-btn' +
        (def.primary ? ' bywl-btn--primary' : '') +
        (def.danger ? ' bywl-btn--danger' : '');
      btn.title = def.title;
      btn.setAttribute('aria-label', def.title);
      btn.appendChild(icon(def.key));

      btn.addEventListener('mousedown', (event) => {
        if (event.button === 1) event.preventDefault();
      });

      btn.addEventListener('auxclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.button !== 1 || !def.middleOpen) return;
        const card = hoverCard;
        if (!card) return;
        const url = card.dataset.bywlUrl || openUrl(card);
        if (url) window.open(url, '_blank', 'noopener');
      });

      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = hoverCard;
        if (!card) return;
        btn.disabled = true;
        try {
          await def.run(card);
          if (def.key === 'remove') hideHover();
        } catch (err) {
          toast(`${def.title} failed: ${err.message}`, true);
          console.error('[bywl]', def.key, err);
        } finally {
          btn.disabled = false;
        }
      });

      hoverEl.appendChild(btn);
    }

    document.body.appendChild(hoverEl);
    return hoverEl;
  }

  function positionHover() {
    if (!hoverCard || !hoverEl) return;
    const thumb = $('ytd-thumbnail', hoverCard) || hoverCard;
    const rect = thumb.getBoundingClientRect();
    if (!rect.width || rect.bottom < 0 || rect.top > innerHeight) return hideHover();
    hoverEl.style.top = `${rect.top}px`;
    hoverEl.style.left = `${rect.left}px`;
    hoverEl.style.width = `${rect.width}px`;
    hoverEl.style.height = `${rect.height}px`;
  }

  function showHover(card) {
    if (settings.layout !== 'grid') return;
    buildHoverOverlay();
    hoverCard = card;

    const url = card.dataset.bywlUrl || openUrl(card);
    if (url) hoverEl.href = url;
    else hoverEl.removeAttribute('href');

    const position =
      $('#index-container #index', card)?.textContent.trim() ||
      String($$(CARD).indexOf(card) + 1);
    const play = $('.bywl-btn--primary', hoverEl);
    if (play) play.title = position;

    positionHover();
    hoverEl.classList.add('bywl-hover--on');
  }

  function hideHover() {
    hoverCard = null;
    hoverEl?.classList.remove('bywl-hover--on');
  }

  function wireCardLinks() {
    if (wireCardLinks.done) return;
    wireCardLinks.done = true;

    const cardOf = (event) => {
      if (CONFIG.INCLUDE_PLAYLIST_VIEW || settings.layout !== 'grid') return null;
      const link = event.target.closest?.('a#video-title, a#thumbnail');
      return link ? link.closest(CARD) : null;
    };

    document.addEventListener(
      'click',
      (event) => {
        const card = cardOf(event);
        if (!card || event.button !== 0 || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        const url = card.dataset.bywlUrl || openUrl(card);
        if (event.ctrlKey || event.metaKey) window.open(url, '_blank', 'noopener');
        else navigate(card);
      },
      true,
    );

    document.addEventListener(
      'auxclick',
      (event) => {
        const card = cardOf(event);
        if (!card || event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        const url = card.dataset.bywlUrl || openUrl(card);
        if (url) window.open(url, '_blank', 'noopener');
      },
      true,
    );

    document.addEventListener(
      'mousedown',
      (event) => {
        if (event.button === 1 && cardOf(event)) event.preventDefault();
      },
      true,
    );
  }

  function wireHover() {
    if (wireHover.done) return;
    wireHover.done = true;

    wireCardLinks();

    document.addEventListener('mouseover', (event) => {
      const target = event.target;
      if (hoverEl && target.closest?.('.bywl-hover')) return;
      const card = target.closest?.(CARD);
      if (card) {
        if (card !== hoverCard) showHover(card);
      } else if (hoverCard) {
        hideHover();
      }
    });

    window.addEventListener('scroll', () => hoverCard && positionHover(), { passive: true });
    window.addEventListener('resize', () => hoverCard && positionHover(), { passive: true });
  }

  function applySortAndFilter() {
    const cards = $$(CARD);
    if (!cards.length) return;

    if (settings.layout !== 'grid') {
      cards.forEach((card) => {
        card.classList.remove('bywl-hidden');
        card.style.order = '';
      });
      return;
    }

    const needle = settings.filter.trim().toLowerCase();
    for (const card of cards) {
      const hit =
        !needle ||
        (card.dataset.bywlTitle || '').includes(needle) ||
        (card.dataset.bywlChannel || '').includes(needle);
      card.classList.toggle('bywl-hidden', !hit);
    }

    if (settings.sort === 'default') {
      cards.forEach((card) => (card.style.order = ''));
      return;
    }

    const key = {
      'duration-asc': (c) => Number(c.dataset.bywlDuration || 0),
      'duration-desc': (c) => -Number(c.dataset.bywlDuration || 0),
      title: (c) => c.dataset.bywlTitle || '',
      channel: (c) => c.dataset.bywlChannel || '',
    }[settings.sort];

    [...cards]
      .sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        return typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb;
      })
      .forEach((card, i) => (card.style.order = String(i)));
  }

  let loading = false;

  function visibleContinuation() {
    return $$([
      'ytd-continuation-item-renderer',
      'yt-page-navigation-progress',
      'tp-yt-paper-spinner[active]',
      'yt-loading-spinner-view-model',
    ].join(',')).some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  async function loadAll(button) {
    if (loading) return;
    loading = true;
    const original = button.textContent;

    try {
      const started = Date.now();
      let lastChange = started;
      let previous = $$(CARD).length;
      let previousHeight = document.documentElement.scrollHeight;
      let cycle = 0;

      while (
        settings.layout === 'grid'
        && Date.now() - started < LOAD_ALL_MAX_MS
      ) {
        const cards = $$(CARD);
        cards[cards.length - 1]?.scrollIntoView({ block: 'end' });
        window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(LOAD_ALL_POLL_MS);

        const count = $$(CARD).length;
        const height = document.documentElement.scrollHeight;
        const isLoading = visibleContinuation();

        if (count !== previous || height !== previousHeight) {
          lastChange = Date.now();
        }

        button.textContent = `Loading… ${count}${total != null ? `/${total}` : ''}`;
        previous = count;
        previousHeight = height;
        cycle += 1;

        if (cycle % 5 === 0) {
          window.scrollBy(0, -Math.max(300, window.innerHeight / 2));
          await sleep(100);
        }

        if (!isLoading && Date.now() - lastChange >= LOAD_ALL_IDLE_MS) break;
      }

      window.scrollTo(0, 0);
      button.textContent = `${previous} loaded`;
      await sleep(1500);
    } finally {
      button.textContent = original;
      loading = false;
    }
  }

  let total = null;

  function headerNodes() {
    return HEADER_ROOTS.flatMap((sel) => $$(sel));
  }

  function findShuffle() {
    for (const root of headerNodes()) {
      const btn = root.querySelector(SHUFFLE_IN_HEADER);
      if (btn) return btn;
    }
    return null;
  }

  function readTotal() {
    for (const root of headerNodes()) {
      const match = root.textContent.replace(/\s+/g, ' ').match(COUNT_RE);
      if (match) {
        const n = Number(match[1].replace(/\D/g, ''));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return null;
  }

  function bumpTotal(delta) {
    if (total == null) return;
    total = Math.max(0, total + delta);
    updateCount();
  }

  function buildMastheadPill() {
    if (total == null) total = readTotal();

    const buttons = $('ytd-masthead #end #buttons') || $('ytd-masthead #buttons');
    if (!buttons) return;

    if ($('.bywl-pill')) return;

    const pill = document.createElement('div');
    pill.className = 'bywl-pill';

    const shuffle = document.createElement('button');
    shuffle.type = 'button';
    shuffle.className = 'bywl-pill-shuffle';
    shuffle.title = 'Shuffle';
    shuffle.setAttribute('aria-label', 'Shuffle');
    shuffle.appendChild(icon('shuffle'));
    shuffle.addEventListener('click', () => {
      const native = findShuffle();
      if (native) native.click();
      else toast('Shuffle button not found in the playlist header', true);
    });

    pill.append(shuffle);

    let anchor = $('#avatar-btn');
    while (anchor && anchor.parentElement !== buttons) anchor = anchor.parentElement;

    buttons.insertBefore(pill, anchor);
  }

  function updateLayoutSwitcher() {
    $$('.bywl-layout-switcher button').forEach((button) => {
      const active = button.dataset.layout === settings.layout;
      button.classList.toggle('bywl-layout-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setLayout(layout) {
    settings.layout = layout === 'standard' ? 'standard' : 'grid';
    saveSettings();
    applyLayout();
    applySortAndFilter();
  }

  function buildLayoutSwitcher() {
    if ($('.bywl-layout-switcher')) return;

    const switcher = el('div', {
      class: 'bywl-layout-switcher',
      role: 'group',
      'aria-label': 'Playlist layout',
    });

    for (const [layout, label] of [['grid', 'Grid'], ['standard', 'Standard']]) {
      const button = el('button', {
        type: 'button',
        text: label,
        title: `${label} layout`,
      });
      button.dataset.layout = layout;
      button.addEventListener('click', () => setLayout(layout));
      switcher.appendChild(button);
    }

    document.body.appendChild(switcher);
    updateLayoutSwitcher();
  }

  function buildToolbar() {
    if ($('.bywl-toolbar')) return;

    const start = $('ytd-masthead #container #start') || $('ytd-masthead #start');
    const fallback =
      $('ytd-browse[page-subtype="playlist"] #primary') || $(LIST)?.parentElement;
    const host = start || fallback;
    if (!host) return;

    const sortSelect = el('select', { class: 'bywl-sort', title: 'Sort playlist' }, [
      el('option', { value: 'default', text: 'Playlist order' }),
      el('option', { value: 'duration-asc', text: 'Shortest first' }),
      el('option', { value: 'duration-desc', text: 'Longest first' }),
      el('option', { value: 'title', text: 'Title A–Z' }),
      el('option', { value: 'channel', text: 'Channel A–Z' }),
    ]);

    // Generate options for thumb size dropdown
    const thumbOptions = [];
    for (let i = THUMB_MIN; i <= THUMB_MAX; i += THUMB_STEP) {
      thumbOptions.push(el('option', { value: i, text: `${i}%` }));
    }
    const thumbSelect = el('select', { class: 'bywl-thumb-select', title: 'Thumbnail size' }, thumbOptions);

    const bar = el('div', { class: 'bywl-toolbar' }, [
      el('label', { class: 'bywl-tool' }, [thumbSelect]),
      el('label', { class: 'bywl-tool' }, [sortSelect]),
      el('input', {
        type: 'search',
        class: 'bywl-filter',
        placeholder: 'Filter…',
      }),
      el('button', { type: 'button', class: 'bywl-loadall', text: 'Load' }),
      el('span', { class: 'bywl-count' }),
    ]);

    const logo = $('#logo', host);
    if (start && logo) logo.after(bar);
    else host.prepend(bar);

    const thumbSelectEl = $('.bywl-thumb-select', bar);
    const sort = $('.bywl-sort', bar);
    const filter = $('.bywl-filter', bar);

    thumbSelectEl.value = settings.thumb;
    sort.value = settings.sort;
    filter.value = settings.filter;

    thumbSelectEl.addEventListener('change', () => {
      settings.thumb = clampThumb(Number(thumbSelectEl.value));
      saveSettings();
      applyLayout();
    });

    sort.addEventListener('change', () => {
      settings.sort = sort.value;
      saveSettings();
      applySortAndFilter();
    });

    filter.addEventListener('input', () => {
      settings.filter = filter.value;
      saveSettings();
      applySortAndFilter();
    });

    $('.bywl-loadall', bar).addEventListener('click', (event) => loadAll(event.currentTarget));
  }

  function applyLayout() {
    const root = document.documentElement;
    const width = Math.round((BASE_CARD_PX * settings.thumb) / 100);
    root.style.setProperty('--bywl-card', `${width}px`);
    root.style.setProperty('--bywl-thumb-h', `${Math.round((width * 9) / 16)}px`);
    root.classList.add('bywl-page');
    root.classList.toggle('bywl-on', settings.layout === 'grid');
    root.classList.toggle('bywl-wide', settings.layout === 'grid');

    if (settings.layout !== 'grid') hideHover();
    updateLayoutSwitcher();
  }

  function updateCount() {
    const el = $('.bywl-count');
    if (!el) return;
    const loaded = $$(CARD).length;
    el.textContent = total != null ? `${loaded}/${total.toLocaleString()}` : `${loaded}`;
  }

  function scan() {
    buildLayoutSwitcher();
    buildToolbar();
    buildMastheadPill();
    wireHover();
    $$(CARD).forEach(decorate);
    applySortAndFilter();
    updateCount();
  }

  let observer;
  let scanTimer;

  function observe() {
    const root = $('ytd-page-manager') || document.body;
    observer?.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        observer.disconnect();
        try {
          scan();
        } finally {
          observer.observe(root, { childList: true, subtree: true });
        }
      }, 150);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function teardown() {
    observer?.disconnect();
    hideHover();
    $('.bywl-pill')?.remove();
    $('.bywl-toolbar')?.remove();
    $('.bywl-layout-switcher')?.remove();
    total = null;
    document.documentElement.classList.remove('bywl-page', 'bywl-on', 'bywl-wide');
  }

  async function start() {
    if (!shouldEnhance()) {
      teardown();
      return;
    }

    try {
      await waitFor(() => $(LIST), 15000);
    } catch {
      teardown();
      return;
    }
    applyLayout();
    observe();
    scan();
  }

  function injectStyle() {
    const css = `
:root {
  --bywl-card: ${Math.round((BASE_CARD_PX * settings.thumb) / 100)}px;
  --bywl-thumb-h: ${Math.round((BASE_CARD_PX * settings.thumb * 9) / 1600)}px;
}

.bywl-layout-switcher { display: none; }
.bywl-page .bywl-layout-switcher {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 9999;
  display: inline-flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--yt-spec-10-percent-layer, rgba(0,0,0,.18));
  border-radius: 18px;
  background: var(--yt-spec-base-background, #fff);
  box-shadow: 0 4px 18px rgba(0,0,0,.28);
  font: 500 13px/1 "Roboto", Arial, sans-serif;
}
.bywl-layout-switcher button {
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 15px;
  background: transparent;
  color: var(--yt-spec-text-primary, #0f0f0f);
  font: inherit;
  cursor: pointer;
}
.bywl-layout-switcher button:hover {
  background: var(--yt-spec-10-percent-layer, rgba(0,0,0,.1));
}
.bywl-layout-switcher .bywl-layout-active {
  background: var(--yt-spec-text-primary, #0f0f0f);
  color: var(--yt-spec-base-background, #fff);
}

/* === FIX: Suchleiste absolut in die Mitte zwingen === */
html.bywl-on ytd-masthead #container,
html.bywl-on ytd-masthead > #container {
  position: relative !important;
}

html.bywl-on ytd-masthead #center,
html.bywl-on ytd-masthead #container > #center {
  position: absolute !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  width: 40vw !important;
  max-width: 700px !important;
  justify-content: center !important;
}

html.bywl-on ytd-searchbox {
  width: 100% !important;
}
/* =================================================== */

.bywl-on ytd-masthead #start {
  flex: 0 1 auto !important;
  min-width: 0 !important;
  overflow: visible !important;
}
.bywl-toolbar { display: none; }
.bywl-on .bywl-toolbar {
  box-sizing: border-box;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  width: auto;
  height: 32px;
  margin: 0 0 0 8px;
  padding: 0 8px 0 4px;
  border-radius: 16px;
  background: var(--yt-spec-badge-chip-background, rgba(0,0,0,.05));
  color: var(--yt-spec-text-primary, #0f0f0f);
  font-family: "Roboto", Arial, sans-serif;
  font-size: 11px;
  white-space: nowrap;
}
.bywl-tool { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }

.bywl-toolbar select,
.bywl-toolbar input[type="search"] {
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--yt-spec-10-percent-layer, rgba(0,0,0,.2));
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

/* Suchfeld stark einkürzen und bei Klick aufklappen lassen */
.bywl-toolbar input[type="search"] {
  width: 50px;
  min-width: 0;
  transition: width 0.2s ease;
}
.bywl-toolbar input[type="search"]:focus {
  width: 120px;
}

.bywl-toolbar select option {
  background: var(--yt-spec-base-background, #fff);
  color: var(--yt-spec-text-primary, #0f0f0f);
}

.bywl-loadall {
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 11px;
  background: var(--yt-spec-text-primary, #0f0f0f);
  color: var(--yt-spec-base-background, #fff);
  font: 500 11px/1 "Roboto", Arial, sans-serif;
  cursor: pointer;
}
.bywl-count {
  padding-left: 2px;
  opacity: .6;
  font-variant-numeric: tabular-nums;
}

.bywl-pill { display: none; }
.bywl-on .bywl-pill {
  display: inline-flex;
  align-items: center;
  margin-right: 8px;
  padding: 2px;
  border-radius: 50%;
  background: var(--yt-spec-badge-chip-background, rgba(0,0,0,.05));
}
.bywl-pill-shuffle {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--yt-spec-text-primary, #0f0f0f);
  cursor: pointer;
}
.bywl-pill-shuffle:hover { background: var(--yt-spec-10-percent-layer, rgba(0,0,0,.15)); }
.bywl-pill-shuffle svg { width: 18px; height: 18px; fill: currentColor; }

.bywl-on ytd-playlist-header-renderer,
.bywl-on ytd-playlist-sidebar-renderer,
.bywl-on ytd-tabbed-page-header,
.bywl-on yt-page-header-renderer,
.bywl-on ytd-browse[page-subtype="playlist"] #page-header,
.bywl-on ytd-browse[page-subtype="playlist"] #page-header-container,
.bywl-on ytd-browse[page-subtype="playlist"] #header,
.bywl-on ytd-browse[page-subtype="playlist"] > #header,
.bywl-on ytd-browse[page-subtype="playlist"] #secondary,
.bywl-on ytd-browse[page-subtype="playlist"] #alerts,
.bywl-on ytd-browse[page-subtype="playlist"] ytd-alert-with-button-renderer,
.bywl-on ytd-browse[page-subtype="playlist"] #masthead-ad,
.bywl-on ytd-browse[page-subtype="playlist"] #alert-banner,
.bywl-on ytd-browse[page-subtype="playlist"] #personal-greeting {
  display: none !important;
}

.bywl-on ytd-browse[page-subtype="playlist"] ytd-two-column-browse-results-renderer {
  display: block !important;
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
}
.bywl-on ytd-browse[page-subtype="playlist"] ytd-section-list-renderer,
.bywl-on ytd-browse[page-subtype="playlist"] ytd-item-section-renderer,
.bywl-on ytd-browse[page-subtype="playlist"] ytd-playlist-video-list-renderer {
  display: block !important;
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
}
.bywl-on ytd-browse[page-subtype="playlist"] ytd-item-section-renderer::after,
.bywl-on ytd-browse[page-subtype="playlist"] ytd-item-section-renderer > #header,
.bywl-on ytd-browse[page-subtype="playlist"] ytd-item-section-renderer > #footer {
  display: none !important;
}
.bywl-on ytd-browse[page-subtype="playlist"] #primary {
  box-sizing: border-box !important;
  display: block !important;
  width: 96% !important;
  max-width: none !important;
  min-width: 0 !important;
  margin: 0 auto !important;
  padding: 0 !important;
}
.bywl-on ytd-playlist-video-list-renderer #sort-filter-menu {
  margin: 0 0 8px !important;
  padding: 0 !important;
}

.bywl-on ytd-playlist-video-list-renderer #contents {
  box-sizing: border-box !important;
  display: grid !important;
  grid-template-columns: repeat(auto-fill, var(--bywl-card)) !important;
  grid-auto-rows: min-content !important;
  justify-content: center !important;
  align-content: start !important;
  align-items: start !important;
  gap: 32px 16px !important;
  width: 100% !important;
  margin: 1% 0 2% !important;
  padding: 0 !important;
  border: 0 !important;
}

.bywl-on ytd-playlist-video-renderer {
  box-sizing: border-box !important;
  position: relative !important;
  display: block !important;
  width: var(--bywl-card) !important;
  max-width: var(--bywl-card) !important;
  min-width: 0 !important;
  height: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  background: none !important;
  box-shadow: none !important;
  overflow: visible !important;
  cursor: pointer !important;
}
.bywl-on ytd-playlist-video-renderer #content,
.bywl-on ytd-playlist-video-renderer #container {
  box-sizing: border-box !important;
  display: block !important;
  float: none !important;
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  height: auto !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}
.bywl-on ytd-playlist-video-renderer.bywl-hidden { display: none !important; }
.bywl-on ytd-playlist-video-renderer.bywl-card--busy { opacity: .35; pointer-events: none; }

.bywl-on ytd-playlist-video-renderer ytd-thumbnail,
.bywl-on ytd-playlist-video-renderer ytd-thumbnail a#thumbnail,
.bywl-on ytd-playlist-video-renderer ytd-thumbnail yt-image {
  display: block !important;
  position: relative !important;
  width: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  height: var(--bywl-thumb-h) !important;
  min-height: var(--bywl-thumb-h) !important;
  max-height: var(--bywl-thumb-h) !important;
  margin: 0 !important;
  padding: 0 !important;
  flex: none !important;
}
.bywl-on ytd-playlist-video-renderer ytd-thumbnail a#thumbnail {
  border-radius: 12px;
  overflow: hidden;
}
.bywl-on ytd-playlist-video-renderer ytd-thumbnail img {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  object-fit: cover !important;
}

.bywl-on ytd-playlist-video-renderer #meta {
  position: relative !important;
  width: 100% !important;
  min-width: 0 !important;
  height: auto !important;
  min-height: 0 !important;
  padding: 10px 0 0 0 !important;
}
.bywl-on ytd-playlist-video-renderer h3,
.bywl-on ytd-playlist-video-renderer h3 #video-title,
.bywl-on ytd-playlist-video-renderer h3 yt-formatted-string {
  margin: 0 !important;
  padding: 0 !important;
}
.bywl-on ytd-playlist-video-renderer a#video-title {
  display: -webkit-box !important;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  font-size: 1.4rem !important;
  line-height: 2rem !important;
  font-weight: 500 !important;
}

.bywl-on ytd-playlist-video-renderer ytd-video-meta-block,
.bywl-on ytd-playlist-video-renderer ytd-video-meta-block #metadata {
  margin: 0 !important;
  padding: 0 !important;
}
.bywl-on ytd-playlist-video-renderer ytd-video-meta-block #byline-container {
  display: block !important;
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
  overflow: visible !important;
}
.bywl-on ytd-playlist-video-renderer ytd-video-meta-block #byline-container > #separator {
  display: none !important;
}
.bywl-on ytd-playlist-video-renderer ytd-video-meta-block #channel-name,
.bywl-on ytd-playlist-video-renderer ytd-video-meta-block #channel-name #container,
.bywl-on ytd-playlist-video-renderer ytd-video-meta-block #channel-name #text-container {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
}
.bywl-on ytd-playlist-video-renderer ytd-video-meta-block #channel-name #text {
  display: block !important;
  width: auto !important;
  max-width: 100% !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}
.bywl-on ytd-playlist-video-renderer ytd-video-meta-block #video-info {
  display: block !important;
  width: 100% !important;
  max-width: none !important;
  overflow: visible !important;
  white-space: nowrap !important;
}

.bywl-on ytd-playlist-video-renderer #index-container { display: none !important; }

.bywl-acting tp-yt-iron-dropdown,
.bywl-acting ytd-menu-popup-renderer {
  opacity: 0 !important;
  pointer-events: none !important;
}

.bywl-on ytd-playlist-video-renderer #menu {
  position: absolute !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

.bywl-hover {
  position: fixed;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  border-radius: 12px;
  background: rgba(0,0,0,.3);
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  opacity: 0;
  transition: none;
  pointer-events: none;
}
.bywl-hover--on {
  opacity: 1;
  pointer-events: auto;
}
.bywl-btn {
  --bywl-btn-size: clamp(26px, calc(var(--bywl-thumb-h) * .32), 46px);
  --bywl-glass: .40;
  position: relative;
  display: grid;
  place-items: center;
  width: var(--bywl-btn-size);
  height: var(--bywl-btn-size);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255,255,255, var(--bywl-glass));
  background-clip: padding-box;
  -webkit-backdrop-filter: blur(3px) saturate(1.2);
  backdrop-filter: blur(3px) saturate(1.2);
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
  color: #fff;
  cursor: pointer;
  isolation: isolate;
  transition: none;
}
.bywl-btn::before,
.bywl-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
}
.bywl-btn::before {
  background: linear-gradient(135deg,
    rgba(255,255,255,.28) 0%,
    rgba(255,255,255,.04) 40%,
    rgba(0,0,0,.06) 60%,
    rgba(0,0,0,.30) 100%);
}
.bywl-btn::after {
  padding: 1.5px;
  opacity: .8;
  background: linear-gradient(135deg,
    rgba(255,255,255,.85) 0%,
    rgba(255,255,255,.18) 42%,
    rgba(0,0,0,.25) 58%,
    rgba(0,0,0,.55) 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
.bywl-btn:hover { --bywl-glass: .60; }
.bywl-btn:disabled { opacity: .4; cursor: default; }
.bywl-btn svg {
  position: relative;
  z-index: 1;
  width: 46%;
  height: 46%;
  opacity: .8;
  fill: currentColor;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.45));
}
.bywl-btn--primary {
  --bywl-btn-size: clamp(36px, calc(var(--bywl-thumb-h) * .45), 64px);
  --bywl-glass: .40;
}
.bywl-btn--primary:hover { --bywl-glass: .60; }
.bywl-btn--primary svg { width: 52%; height: 52%; opacity: 1; }

.bywl-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 9999;
  transform: translate(-50%, 12px);
  padding: 10px 18px;
  border-radius: 10px;
  background: #f1f1f1;
  color: #0f0f0f;
  font: 500 13px/1 "Roboto", Arial, sans-serif;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s, transform .15s;
}
.bywl-toast--on { opacity: 1; transform: translate(-50%, 0); }
.bywl-toast--error { background: #cc0000; color: #fff; }

yt-content-metadata-view-model a[href*="/playlist?list="],
ytd-playlist-renderer #view-more a,
ytd-radio-renderer #view-more a,
ytd-playlist-renderer a.yt-simple-endpoint[href*="/playlist?list="]:not(#thumbnail):not(#video-title) {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  margin: 4px 0 2px;
  padding: 0 14px;
  border-radius: 999px;
  background: linear-gradient(90deg, #4facff, #7b61ff, #b16cff, #7b61ff, #4facff);
  background-size: 300% 100%;
  box-shadow: 0 2px 10px rgba(112,100,255,.45), inset 0 1px 0 rgba(255,255,255,.35);
  color: #fff !important;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none !important;
  white-space: nowrap;
  animation: bywl-playlist-shine 8s linear infinite;
  transition: box-shadow .4s ease;
}
yt-content-metadata-view-model a[href*="/playlist?list="]::before,
ytd-playlist-renderer #view-more a::before,
ytd-radio-renderer #view-more a::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: rgba(255,255,255,.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity .4s ease;
}
yt-content-metadata-view-model a[href*="/playlist?list="] *,
ytd-playlist-renderer #view-more a *,
ytd-radio-renderer #view-more a * {
  position: relative;
  color: #fff !important;
}
yt-content-metadata-view-model a[href*="/playlist?list="]:hover,
ytd-playlist-renderer #view-more a:hover,
ytd-radio-renderer #view-more a:hover {
  box-shadow: 0 4px 16px rgba(112,100,255,.7), inset 0 1px 0 rgba(255,255,255,.5);
}
yt-content-metadata-view-model a[href*="/playlist?list="]:hover::before,
ytd-playlist-renderer #view-more a:hover::before,
ytd-radio-renderer #view-more a:hover::before {
  opacity: 1;
}
@keyframes bywl-playlist-shine {
  from { background-position: 0 0; }
  to { background-position: -300% 0; }
}
@media (prefers-reduced-motion: reduce) {
  yt-content-metadata-view-model a[href*="/playlist?list="],
  ytd-playlist-renderer #view-more a,
  ytd-radio-renderer #view-more a { animation: none; }
}
`;
    const style = document.createElement('style');
    style.id = 'bywl-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function boot() {
    injectStyle();
    start();
    window.addEventListener('yt-navigate-finish', () => setTimeout(start, 300));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
