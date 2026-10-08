'use strict';

const $ = (id) => document.getElementById(id);
const send = (msg) => browser.runtime.sendMessage(msg);

const SVG_PENCIL =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>' +
  '<path d="m15 5 4 4"/>' +
  '</svg>';

const SVG_TRASH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 6h18"/>' +
  '<path d="M8 6V4h8v2"/>' +
  '<path d="M19 6l-1 15H6L5 6"/>' +
  '<path d="M10 11v6M14 11v6"/>' +
  '</svg>';

const SVG_STAR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' +
  '</svg>';

const SVG_GLASSES =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="6" cy="15" r="4"/>' +
  '<circle cx="18" cy="15" r="4"/>' +
  '<path d="M14 15a2 2 0 0 0-4 0"/>' +
  '<path d="M2.5 13 4 7c.3-.9 1.1-1.5 2-1.5h1"/>' +
  '<path d="m21.5 13-1.5-6c-.3-.9-1.1-1.5-2-1.5h-1"/>' +
  '</svg>';

const state = {
  token: null,
  urlStatusEnabled: false,
  cursor: null,
  hasMore: false,
  loadingList: false,
  activeTabId: null,
  activeTabUrl: null,
  activeBookmark: null,
  filter: 'all', // 'all', 'toread', 'starred'
  searchQuery: '',
  items: [],
};

function show(el) {
  el.classList.remove('hidden');
}
function hide(el) {
  el.classList.add('hidden');
}

function statusEl(el, message, kind) {
  el.textContent = message;
  el.classList.toggle('err', kind === 'err');
  el.classList.toggle('ok', kind === 'ok');
  show(el);
}

function switchView(name) {
  for (const v of ['bookmarks', 'edit', 'settings']) {
    $('view-' + v).classList.toggle('hidden', v !== name);
  }
  if (name === 'bookmarks') loadBookmarks(true);
  if (name === 'settings') {
    show($('no-token-banner'));
    $('token').focus();
  }
}

/* ---------- Overlay (quick save) ---------- */

const overlay = {
  el: null,
  spinnerEl: null,
  contentEl: null,
  timer: null,

  init() {
    this.el = $('save-overlay');
    this.spinnerEl = $('save-spinner');
    this.contentEl = $('save-content');
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  },

  showSaving() {
    this.contentEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'save-message';
    msg.textContent = 'Speichere …';
    this.contentEl.append(msg);
    show(this.spinnerEl);
    show(this.el);
  },

  showResult({ ok, message, bookmark, editUrl, noToken }) {
    const self = this;
    this.contentEl.innerHTML = '';
    hide(this.spinnerEl);

    const msg = document.createElement('div');
    msg.className = 'save-message' + (ok ? '' : ' error');
    if (ok) {
      const check = document.createElement('span');
      check.className = 'check';
      msg.append(check);
    }
    msg.append(document.createTextNode(message));
    this.contentEl.append(msg);

    if (ok && bookmark) {
      this.contentEl.append(buildSavedCard(bookmark, editUrl));
    }

    if (noToken) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = 'Zu den Einstellungen';
      btn.addEventListener('click', () => {
        self.close();
        switchView('settings');
      });
      this.contentEl.append(btn);
    }

    show(this.el);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.close(), ok ? 4000 : 6000);
  },

  close() {
    clearTimeout(this.timer);
    hide(this.el);
  },
};

function buildSavedCard(bm, editUrl) {
  const card = document.createElement('div');
  card.className = 'saved-bookmark';

  const title = document.createElement('span');
  title.className = 'bm-title';
  title.textContent = bm.title || bm.url || '(ohne Titel)';
  card.append(title);

  if (bm.tags && bm.tags.length) {
    const meta = document.createElement('span');
    meta.className = 'bm-meta';
    const tags = document.createElement('span');
    tags.className = 'bm-tags';
    for (const tag of bm.tags.slice(0, 5)) {
      const chip = document.createElement('span');
      chip.className = 'bm-tag';
      chip.textContent = tag;
      tags.appendChild(chip);
    }
    meta.append(tags);
    card.append(meta);
  }

  const actions = document.createElement('div');
  actions.className = 'saved-actions';

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Bearbeiten';
  if (editUrl) {
    editBtn.addEventListener('click', () => {
      browser.tabs.create({ url: editUrl });
      window.close();
    });
  } else {
    editBtn.disabled = true;
    editBtn.title = 'Keine Edit-URL verfügbar';
  }
  actions.append(editBtn);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'primary-action';
  doneBtn.textContent = 'Fertig';
  doneBtn.addEventListener('click', () => {
    overlay.close();
    loadBookmarks(true);
  });
  actions.append(doneBtn);

  card.append(actions);
  return card;
}

/* ---------- Save & Active Tab Check ---------- */

function isAudioFileUrl(value) {
  try {
    const pathname = decodeURIComponent(new URL(value).pathname).toLowerCase();
    const extension = pathname.match(/\.([a-z0-9]+)$/)?.[1];
    return Boolean(
      extension &&
        new Set([
          'aac', 'aif', 'aiff', 'amr', 'au', 'caf', 'flac', 'm4a', 'm4b',
          'mka', 'mp2', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'wave', 'weba', 'wma',
        ]).has(extension)
    );
  } catch (_) {
    return false;
  }
}

function isVideoPageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch (_) {
    return false;
  }
}

async function extractActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || tab.id == null) return null;
  state.activeTabId = tab.id;
  state.activeTabUrl = tab.url;
  return tab;
}

async function checkActiveTabStatus() {
  if (!state.urlStatusEnabled) return;
  const tab = await extractActiveTab();
  if (!tab || !tab.url) return;
  try {
    const res = await send({ type: 'check-url', url: tab.url });
    if (res && res.saved) {
      state.activeBookmark = res.bookmark || { id: res.id, url: tab.url };
      const btn = $('save-btn-head');
      btn.classList.add('already-saved');
      btn.title = 'Bereits gespeichert – Zum Bearbeiten klicken';
    }
  } catch (_) {}
}

async function handleQuickSave() {
  const btn = $('save-btn-head');
  if (btn.disabled) return;

  // If active page is already saved, click directly opens edit view
  if (state.activeBookmark && state.activeBookmark.id) {
    openEdit(state.activeBookmark.id);
    return;
  }

  overlay.init();
  btn.classList.add('saving');
  overlay.showSaving();

  let finished = false;
  const done = (fn) => {
    if (finished) return;
    finished = true;
    btn.classList.remove('saving');
    fn();
  };

  try {
    if (!state.token) {
      done(() => overlay.showResult({
        ok: false,
        message: 'Kein API-Token – bitte in den Einstellungen hinterlegen.',
        noToken: true,
      }));
      return;
    }

    const tab = await extractActiveTab();
    if (!tab) {
      done(() => overlay.showResult({ ok: false, message: 'Kein aktiver Tab gefunden.' }));
      return;
    }

    const extracted = await send({ type: 'extract', tabId: tab.id });
    if (!extracted || !extracted.ok) {
      done(() => overlay.showResult({
        ok: false,
        message: (extracted && extracted.message) || 'Konnte Seite nicht lesen.',
      }));
      return;
    }

    const data = extracted.data || {};
    // Episode logic: YouTube pages and direct audio URLs are saved as episodes.
    const episode = isVideoPageUrl(data.url) || isAudioFileUrl(data.url);

    const res = await send({ type: 'save', data, episode });
    if (!res || !res.ok) {
      done(() => overlay.showResult({
        ok: false,
        message: (res && res.message) || 'Fehler beim Speichern.',
        noToken: res && res.code === 'no-token',
      }));
      return;
    }

    done(() => {
      overlay.showResult({
        ok: true,
        message: res.message || 'Gespeichert',
        bookmark: { title: data.title, url: data.url, tags: data.tags },
        editUrl: editUrlFor({ id: res.id }) || null,
      });
      state.activeBookmark = { id: res.id, url: data.url, title: data.title, tags: data.tags };
      btn.classList.add('already-saved');
      btn.title = 'Bereits gespeichert – Zum Bearbeiten klicken';
    });
  } catch (err) {
    done(() => overlay.showResult({
      ok: false,
      message: String(err && err.message ? err.message : err),
    }));
  }
}

/* ---------- Bookmarks list ---------- */

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function editUrlFor(bm) {
  if (bm.id) return `https://breadcrum.net/bookmarks/view/?id=${encodeURIComponent(bm.id)}`;
  return null;
}

function tagsToString(tags) {
  if (!tags) return '';
  if (Array.isArray(tags)) return tags.filter(Boolean).join(', ');
  return String(tags);
}

function parseTagsInput(value) {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

let editContext = { id: null, loaded: null, dirty: false };

function setEditStatus(message, kind) {
  const el = $('edit-status');
  el.textContent = message || '';
  el.classList.remove('ok', 'err');
  if (message) {
    el.classList.toggle('err', kind === 'err');
    el.classList.toggle('ok', kind === 'ok');
    show(el);
  } else {
    hide(el);
  }
}

function setEditBusy(busy) {
  $('edit-save').disabled = busy;
  $('edit-delete').disabled = busy;
  $('edit-cancel').disabled = busy;
  $('edit-title').disabled = busy;
  $('edit-url').disabled = busy;
  $('edit-tags').disabled = busy;
  $('edit-note').disabled = busy;
  $('edit-starred').disabled = busy;
  $('edit-toread').disabled = busy;
}

async function openEdit(bookmarkOrId) {
  const id = typeof bookmarkOrId === 'string' ? bookmarkOrId : bookmarkOrId && bookmarkOrId.id;
  if (!id) return;

  editContext = { id, loaded: null, dirty: false };
  switchView('edit');
  $('edit-form').classList.add('hidden');
  $('edit-loading').classList.remove('hidden');
  $('edit-loading').textContent = 'Lade Bookmark …';
  setEditStatus('', null);

  try {
    const res = await send({ type: 'get', id });
    if (!res || !res.ok) {
      $('edit-loading').textContent = (res && res.message) || 'Konnte Bookmark nicht laden.';
      return;
    }
    const bm = res.data || {};
    editContext.loaded = bm;
    fillEditForm(bm);
    $('edit-loading').classList.add('hidden');
    $('edit-form').classList.remove('hidden');
    $('edit-title').focus();
    $('edit-title').select();
  } catch (err) {
    $('edit-loading').textContent = String((err && err.message) || err);
  }
}

function fillEditForm(bm) {
  $('edit-title').value = bm.title || '';
  $('edit-url').value = bm.url || '';
  $('edit-tags').value = tagsToString(bm.tags);
  $('edit-note').value = bm.note || '';
  $('edit-starred').checked = Boolean(bm.starred);
  $('edit-toread').checked = Boolean(bm.toread);
}

function collectEditForm() {
  return {
    title: $('edit-title').value.trim(),
    url: $('edit-url').value.trim(),
    tags: parseTagsInput($('edit-tags').value),
    note: $('edit-note').value,
    starred: $('edit-starred').checked,
    toread: $('edit-toread').checked,
  };
}

async function submitEdit(ev) {
  ev.preventDefault();
  if (!editContext.id) return;
  setEditStatus('', null);
  setEditBusy(true);

  const form = collectEditForm();
  if (!form.url) {
    setEditStatus('URL darf nicht leer sein.', 'err');
    setEditBusy(false);
    $('edit-url').focus();
    return;
  }

  try {
    const res = await send({ type: 'update', id: editContext.id, patch: form });
    if (!res || !res.ok) {
      setEditStatus((res && res.message) || 'Speichern fehlgeschlagen.', 'err');
      setEditBusy(false);
      return;
    }
    setEditStatus('Gespeichert ✓', 'ok');
    setEditBusy(false);
    editContext.loaded = res.data || { ...(editContext.loaded || {}), ...form };
    if (state.activeBookmark && String(state.activeBookmark.id) === String(editContext.id)) {
      if (form.url === state.activeTabUrl) {
        state.activeBookmark = { ...state.activeBookmark, ...form };
      } else {
        state.activeBookmark = null;
        $('save-btn-head').classList.remove('already-saved');
        $('save-btn-head').title = 'Aktuelle Seite speichern';
      }
    }
    loadBookmarks(true);
  } catch (err) {
    setEditStatus(String((err && err.message) || err), 'err');
    setEditBusy(false);
  }
}

let deleteArmed = false;
let deleteTimer = null;

function armDelete() {
  const btn = $('edit-delete');
  if (deleteArmed) {
    performDelete();
    return;
  }
  deleteArmed = true;
  btn.textContent = 'Wirklich löschen?';
  btn.classList.add('armed');
  clearTimeout(deleteTimer);
  deleteTimer = setTimeout(() => {
    deleteArmed = false;
    btn.textContent = 'Löschen …';
    btn.classList.remove('armed');
  }, 3000);
}

async function performDelete() {
  if (!editContext.id) return;
  clearTimeout(deleteTimer);
  deleteArmed = false;
  setEditBusy(true);
  setEditStatus('', null);
  try {
    const res = await send({ type: 'delete', id: editContext.id });
    if (!res || !res.ok) {
      setEditStatus((res && res.message) || 'Löschen fehlgeschlagen.', 'err');
      setEditBusy(false);
      return;
    }
    if (state.activeBookmark && state.activeBookmark.id === editContext.id) {
      state.activeBookmark = null;
      $('save-btn-head').classList.remove('already-saved');
      $('save-btn-head').title = 'Aktuelle Seite speichern';
    }
    switchView('bookmarks');
    loadBookmarks(true);
  } catch (err) {
    setEditStatus(String((err && err.message) || err), 'err');
    setEditBusy(false);
  }
}

/* ---------- Inline ⭐ and 👓 Quick Toggles ---------- */

async function toggleStar(bm, btn) {
  if (!bm.id) return;
  const nextStarred = !bm.starred;
  bm.starred = nextStarred;
  btn.classList.toggle('active', nextStarred);
  btn.title = nextStarred ? 'Favorit entfernen' : 'Als Favorit markieren';
  btn.setAttribute('aria-label', btn.title);

  try {
    const res = await send({ type: 'update', id: bm.id, patch: { starred: nextStarred } });
    if (!res || !res.ok) {
      bm.starred = !nextStarred;
      btn.classList.toggle('active', !nextStarred);
      statusEl($('bm-status'), (res && res.message) || 'Änderung fehlgeschlagen.', 'err');
    }
  } catch (err) {
    bm.starred = !nextStarred;
    btn.classList.toggle('active', !nextStarred);
    statusEl($('bm-status'), String((err && err.message) || err), 'err');
  }
}

async function toggleToread(bm, btn) {
  if (!bm.id) return;
  const nextToread = !bm.toread;
  bm.toread = nextToread;
  btn.classList.toggle('active', nextToread);
  btn.title = nextToread ? 'Als gelesen markieren' : 'Auf To-Read Liste setzen';
  btn.setAttribute('aria-label', btn.title);

  try {
    const res = await send({ type: 'update', id: bm.id, patch: { toread: nextToread } });
    if (!res || !res.ok) {
      bm.toread = !nextToread;
      btn.classList.toggle('active', !nextToread);
      statusEl($('bm-status'), (res && res.message) || 'Änderung fehlgeschlagen.', 'err');
    }
  } catch (err) {
    bm.toread = !nextToread;
    btn.classList.toggle('active', !nextToread);
    statusEl($('bm-status'), String((err && err.message) || err), 'err');
  }
}

function bookmarkItem(bm) {
  const row = document.createElement('div');
  row.className = 'bm-row';

  const a = document.createElement('a');
  a.className = 'bm-item';
  a.href = bm.url || '#';
  a.target = '_blank';
  a.rel = 'noreferrer';

  const title = document.createElement('span');
  title.className = 'bm-title';
  title.textContent = bm.title || bm.url || '(ohne Titel)';

  const meta = document.createElement('span');
  meta.className = 'bm-meta';

  const tags = document.createElement('span');
  tags.className = 'bm-tags';
  for (const tag of (bm.tags || []).slice(0, 5)) {
    const chip = document.createElement('span');
    chip.className = 'bm-tag';
    chip.textContent = tag;
    tags.appendChild(chip);
  }

  const metaRight = document.createElement('span');
  metaRight.className = 'bm-meta-right';

  const toggles = document.createElement('span');
  toggles.className = 'bm-toggles';

  const starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = 'bm-toggle bm-toggle-star' + (bm.starred ? ' active' : '');
  starBtn.title = bm.starred ? 'Favorit entfernen' : 'Als Favorit markieren';
  starBtn.setAttribute('aria-label', starBtn.title);
  starBtn.innerHTML = SVG_STAR;
  starBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleStar(bm, starBtn);
  });

  const toreadBtn = document.createElement('button');
  toreadBtn.type = 'button';
  toreadBtn.className = 'bm-toggle bm-toggle-toread' + (bm.toread ? ' active' : '');
  toreadBtn.title = bm.toread ? 'Als gelesen markieren' : 'Auf To-Read Liste setzen';
  toreadBtn.setAttribute('aria-label', toreadBtn.title);
  toreadBtn.innerHTML = SVG_GLASSES;
  toreadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleToread(bm, toreadBtn);
  });

  toggles.append(starBtn, toreadBtn);

  const date = document.createElement('span');
  date.className = 'bm-date';
  date.textContent = fmtDate(bm.created_at);

  metaRight.append(toggles, date);
  meta.append(tags, metaRight);
  a.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'bm-actions';

  const edit = document.createElement('button');
  edit.className = 'bm-action bm-edit';
  edit.title = 'Bookmark bearbeiten';
  edit.setAttribute('aria-label', 'Bookmark bearbeiten: ' + (bm.title || bm.url || ''));
  edit.innerHTML = SVG_PENCIL;
  if (bm.id) {
    edit.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEdit(bm);
    });
  } else {
    edit.disabled = true;
    edit.title = 'Keine ID für Edit verfügbar';
  }

  const remove = document.createElement('button');
  remove.className = 'bm-action bm-delete';
  remove.title = 'Bookmark löschen';
  remove.setAttribute('aria-label', 'Bookmark löschen: ' + (bm.title || bm.url || ''));
  remove.innerHTML = SVG_TRASH;
  if (bm.id) {
    remove.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      armRowDelete(bm, row, remove);
    });
  } else {
    remove.disabled = true;
    remove.title = 'Keine ID zum Löschen verfügbar';
  }

  actions.append(edit, remove);
  row.append(a, actions);
  return row;
}

function armRowDelete(bm, row, btn) {
  if (btn.dataset.armed === 'true') {
    performRowDelete(bm, row, btn);
    return;
  }

  btn.dataset.armed = 'true';
  btn.classList.add('armed');
  row.classList.add('row-armed');
  btn.title = 'Zum Bestätigen erneut klicken';
  btn.setAttribute('aria-label', 'Löschen bestätigen: ' + (bm.title || bm.url || ''));

  clearTimeout(btn.deleteTimer);
  btn.deleteTimer = setTimeout(() => {
    btn.dataset.armed = 'false';
    btn.classList.remove('armed');
    row.classList.remove('row-armed');
    btn.title = 'Bookmark löschen';
    btn.setAttribute('aria-label', 'Bookmark löschen: ' + (bm.title || bm.url || ''));
  }, 3000);
}

async function performRowDelete(bm, row, btn) {
  clearTimeout(btn.deleteTimer);
  btn.dataset.armed = 'false';
  row.classList.remove('row-armed');
  btn.disabled = true;
  row.classList.add('deleting');

  const edit = row.querySelector('.bm-edit');
  if (edit) edit.disabled = true;

  try {
    const res = await send({ type: 'delete', id: bm.id });
    if (!res || !res.ok) {
      row.classList.remove('deleting');
      btn.disabled = false;
      if (edit) edit.disabled = false;
      statusEl($('bm-status'), (res && res.message) || 'Löschen fehlgeschlagen.', 'err');
      return;
    }
    if (state.activeBookmark && state.activeBookmark.id === bm.id) {
      state.activeBookmark = null;
      $('save-btn-head').classList.remove('already-saved');
      $('save-btn-head').title = 'Aktuelle Seite speichern';
    }
    state.items = state.items.filter((item) => item.id !== bm.id);
    applySearchFilter();
  } catch (err) {
    row.classList.remove('deleting');
    btn.disabled = false;
    if (edit) edit.disabled = false;
    statusEl($('bm-status'), String((err && err.message) || err), 'err');
  }
}

function renderBookmarks(items, append) {
  const list = $('bm-list');
  if (!append) list.textContent = '';
  if (!items.length) {
    if (!append) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = state.searchQuery ? 'Keine passenden Bookmarks gefunden.' : 'Keine Bookmarks gefunden.';
      list.appendChild(li);
    }
    return;
  }
  for (const bm of items) list.appendChild(bookmarkItem(bm));
}

/* ---------- Search and Filter Logic ---------- */

function getFilteredItems() {
  const q = state.searchQuery.toLowerCase();
  if (!q) return state.items;
  return state.items.filter((bm) => {
    if (bm.title && bm.title.toLowerCase().includes(q)) return true;
    if (bm.url && bm.url.toLowerCase().includes(q)) return true;
    if (bm.note && bm.note.toLowerCase().includes(q)) return true;
    if (Array.isArray(bm.tags) && bm.tags.some((t) => t && t.toLowerCase().includes(q))) return true;
    return false;
  });
}

function applySearchFilter() {
  const filtered = getFilteredItems();
  renderBookmarks(filtered);
  updateCounts(filtered.length);
}

function updateCounts(visibleCount) {
  if (state.searchQuery) {
    $('bm-count').textContent = `${visibleCount} von ${state.items.length} Treffer`;
    $('bm-more').classList.add('hidden');
  } else {
    $('bm-count').textContent = state.items.length
      ? `${state.items.length} ${state.cursor ? 'geladen' : 'zuletzt gespeichert'}`
      : '';
    $('bm-more').classList.toggle('hidden', !state.hasMore);
  }
}

function initSearchAndFilters() {
  const searchInput = $('bm-search');
  const searchClear = $('bm-search-clear');
  const filterChips = $('bm-filter-chips');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    searchClear.classList.toggle('hidden', !state.searchQuery);
    applySearchFilter();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    hide(searchClear);
    applySearchFilter();
    searchInput.focus();
  });

  if (filterChips) {
    filterChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-chip');
      if (!btn || btn.classList.contains('active')) return;

      for (const chip of filterChips.querySelectorAll('.filter-chip')) {
        chip.classList.remove('active');
      }
      btn.classList.add('active');
      state.filter = btn.dataset.filter || 'all';

      const openSite = $('bm-open-site');
      if (state.filter === 'toread') {
        openSite.href = 'https://breadcrum.net/bookmarks?toread=true';
      } else if (state.filter === 'starred') {
        openSite.href = 'https://breadcrum.net/bookmarks?starred=true';
      } else {
        openSite.href = 'https://breadcrum.net/bookmarks';
      }

      loadBookmarks(true);
    });
  }
}

async function loadBookmarks(reset) {
  if (state.loadingList) return;
  state.loadingList = true;

  if (reset) {
    state.cursor = null;
    state.items = [];
    $('bm-list').textContent = '';
    $('bm-count').textContent = '';
  }

  const listParams = { before: state.cursor };
  if (state.filter === 'toread') listParams.toread = true;
  if (state.filter === 'starred') listParams.starred = true;

  try {
    const res = await send({ type: 'list', ...listParams });
    if (!res || !res.ok) {
      statusEl($('bm-status'), res && res.message ? res.message : 'Liste nicht abrufbar.', 'err');
      return;
    }
    const items = res.data || [];
    state.cursor = (res.pagination && res.pagination.before) || null;
    state.hasMore = Boolean(state.cursor);

    if (reset) {
      state.items = items;
    } else {
      state.items.push(...items);
    }

    applySearchFilter();

    $('bm-status').textContent = '';
    $('bm-status').classList.add('hidden');
  } catch (err) {
    statusEl($('bm-status'), 'Konnte nicht mit dem Hintergrund kommunizieren: ' + (err && err.message ? err.message : err), 'err');
  } finally {
    state.loadingList = false;
  }
}

/* ---------- Settings & Initialization ---------- */

$('settings-toggle').addEventListener('click', () => switchView('settings'));
$('save-btn-head').addEventListener('click', handleQuickSave);
$('bm-more').addEventListener('click', () => loadBookmarks(false));
$('edit-form').addEventListener('submit', submitEdit);
$('edit-cancel').addEventListener('click', () => switchView('bookmarks'));
$('edit-delete').addEventListener('click', armDelete);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !overlay.el.classList.contains('hidden')) {
    overlay.close();
    return;
  }
  if (e.key === 'Escape' && !$('view-edit').classList.contains('hidden')) {
    switchView('bookmarks');
  }
});

$('token-save').addEventListener('click', async () => {
  const token = $('token').value.trim();
  const status = $('token-status');
  const btn = $('token-save');
  btn.disabled = true;
  status.classList.remove('ok', 'err');
  show(status);

  if (token) {
    status.textContent = 'Prüfe Token …';
    try {
      await send({ type: 'set-token', token });
      const check = await send({ type: 'validate-token' });
      if (!check || !check.ok) {
        await send({ type: 'set-token', token: '' });
        state.token = null;
        btn.disabled = false;
        status.classList.add('err');
        status.textContent = (check && check.message) || 'Token ungültig.';
        $('save-btn-head').disabled = true;
        show($('no-token-banner'));
        return;
      }
    } catch (err) {
      state.token = null;
      btn.disabled = false;
      status.classList.add('err');
      status.textContent = 'Konnte nicht mit dem Hintergrund kommunizieren: ' + (err && err.message ? err.message : err);
      $('save-btn-head').disabled = true;
      show($('no-token-banner'));
      return;
    }
  } else {
    await send({ type: 'set-token', token: '' });
  }

  state.token = token || null;
  btn.disabled = false;
  status.classList.add('ok');
  status.textContent = token ? 'Token gespeichert und verifiziert.' : 'Token entfernt.';
  $('save-btn-head').disabled = !state.token;
  if (state.token) hide($('no-token-banner'));
  if (state.token) checkActiveTabStatus();
});

$('url-status-enabled').addEventListener('change', async (event) => {
  state.urlStatusEnabled = event.target.checked;
  try {
    await send({ type: 'set-url-status-enabled', enabled: state.urlStatusEnabled });
    state.activeBookmark = null;
    $('save-btn-head').classList.remove('already-saved');
    $('save-btn-head').title = 'Aktuelle Seite speichern';
    if (state.urlStatusEnabled && state.token) checkActiveTabStatus();
  } catch (err) {
    state.urlStatusEnabled = !event.target.checked;
    event.target.checked = state.urlStatusEnabled;
    statusEl($('token-status'), 'Einstellung konnte nicht gespeichert werden: ' + (err && err.message ? err.message : err), 'err');
  }
});

(async function init() {
  overlay.init();
  initSearchAndFilters();
  let res;
  try {
    res = await send({ type: 'get-token' });
  } catch (err) {
    statusEl($('bm-status'), 'Konnte nicht mit dem Hintergrund kommunizieren: ' + (err && err.message ? err.message : err), 'err');
    return;
  }
  state.token = res && res.token ? res.token : null;
  try {
    const urlStatus = await send({ type: 'get-url-status-enabled' });
    state.urlStatusEnabled = Boolean(urlStatus && urlStatus.enabled);
    $('url-status-enabled').checked = state.urlStatusEnabled;
  } catch (_) {}
  $('token').value = state.token || '';
  $('save-btn-head').disabled = !state.token;
  if (!state.token) {
    show($('no-token-banner'));
    switchView('settings');
  } else {
    hide($('no-token-banner'));
    checkActiveTabStatus();
  }
  loadBookmarks(true);
})();
