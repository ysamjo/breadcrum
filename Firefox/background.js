'use strict';

if (typeof importScripts === 'function' && typeof browser === 'undefined') {
  importScripts('lib/browser-polyfill.min.js');
}

const API_BASE = 'https://breadcrum.net';
const actionApi = typeof browser !== 'undefined' && (browser.action || browser.browserAction);
const urlStatusCache = new Map();

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function setSavedBadge(tabId, isSaved) {
  if (!actionApi) return;
  try {
    if (isSaved) {
      if (actionApi.setBadgeText) {
        await actionApi.setBadgeText({ text: '✓', tabId });
      }
      if (actionApi.setBadgeBackgroundColor) {
        await actionApi.setBadgeBackgroundColor({ color: '#1e7d32', tabId });
      }
      if (actionApi.setTitle) {
        await actionApi.setTitle({ title: 'Breadcrum – Bereits gespeichert ✓', tabId });
      }
    } else {
      if (actionApi.setBadgeText) {
        await actionApi.setBadgeText({ text: '', tabId });
      }
      if (actionApi.setTitle) {
        await actionApi.setTitle({ title: 'Breadcrum – Speichern', tabId });
      }
    }
  } catch (_) {
    /* tab might have closed */
  }
}

async function checkUrlSaved(url) {
  if (!url || !isHttpUrl(url)) return { saved: false, id: null };
  const cached = urlStatusCache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < 180000) {
    return cached;
  }
  try {
    const token = await getToken();
    if (!token) return { saved: false, id: null };
    const query = `?url=${encodeURIComponent(url)}&exact_url=true`;
    const res = await api('/api/bookmarks', { query });
    const items = Array.isArray(res?.data) ? res.data : (res?.data ? [res.data] : []);
    const saved = items.length > 0;
    const bm = saved ? items[0] : null;
    const entry = { saved, id: bm?.id || null, bookmark: bm, ts: now };
    urlStatusCache.set(url, entry);
    return entry;
  } catch (_) {
    return { saved: false, id: null };
  }
}

async function updateTabBadge(tabId, url) {
  if (!tabId) return;
  if (!url || !isHttpUrl(url)) {
    await setSavedBadge(tabId, false);
    return;
  }
  const status = await checkUrlSaved(url);
  await setSavedBadge(tabId, status.saved);
}

async function refreshActiveTabBadge() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (tab && tab.id != null && tab.url) {
      await updateTabBadge(tab.id, tab.url);
    }
  } catch (_) {}
}

const AUDIO_FILE_EXTENSIONS = new Set([
  'aac', 'aif', 'aiff', 'amr', 'au', 'caf', 'flac', 'm4a', 'm4b',
  'mka', 'mp2', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'wave', 'weba', 'wma',
]);

function isAudioFileUrl(value) {
  try {
    const pathname = decodeURIComponent(new URL(value).pathname).toLowerCase();
    const extension = pathname.match(/\.([a-z0-9]+)$/)?.[1];
    return Boolean(extension && AUDIO_FILE_EXTENSIONS.has(extension));
  } catch (_) {
    return false;
  }
}

function getToken() {
  return browser.storage.local.get('token').then((r) => (r && r.token) || null);
}

async function api(path, { method = 'GET', body, query = '' } = {}) {
  const token = await getToken();
  if (!token) {
    const err = new Error('no-token');
    err.code = 'no-token';
    throw err;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}${query}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* empty body */
  }

  if (!res.ok) {
    const errMessage = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(String(errMessage));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function friendlyError(err) {
  if (err && err.code === 'no-token') {
    return {
      ok: false,
      code: 'no-token',
      message: 'Kein API-Token konfiguriert – in den Einstellungen der Extension hinterlegen.',
    };
  }
  if (err && err.status === 401) {
    return {
      ok: false,
      message: 'Token ungültig oder abgelaufen – bitte in den Einstellungen erneuern.',
    };
  }
  return { ok: false, message: err && err.message ? err.message : 'Unbekannter Fehler' };
}

async function saveBookmark(data, { meta = false, episode = false } = {}) {
  const body = {
    url: data.url,
    title: data.title || undefined,
    note: data.note || undefined,
    summary: data.summary || undefined,
    tags: Array.isArray(data.tags) && data.tags.length ? data.tags.filter(Boolean) : undefined,
  };
  const createEpisode = Boolean(episode) || isAudioFileUrl(data.url);
  const query = `?${new URLSearchParams({
    meta: String(Boolean(meta)),
    episode: String(createEpisode),
    archive: 'false',
    normalize: 'true',
  }).toString()}`;
  const result = await api('/api/bookmarks', { method: 'PUT', body, query });

  const id = result && result.data ? result.data.id : null;
  const status = result && result.status ? result.status : 'unknown';
  if (data.url) {
    urlStatusCache.set(data.url, { saved: true, id, bookmark: result?.data, ts: Date.now() });
    refreshActiveTabBadge();
  }
  const messages = {
    created: 'Gespeichert ✓',
    nochange: 'Bereits in Breadcrum vorhanden',
  };
  return {
    ok: true,
    status,
    message: messages[status] || 'Gespeichert',
    site_url: result && result.site_url,
    id,
  };
}

async function deleteBookmark(id) {
  const res = await api(`/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  for (const [url, entry] of urlStatusCache.entries()) {
    if (entry.id === id) {
      urlStatusCache.set(url, { saved: false, id: null, ts: Date.now() });
    }
  }
  refreshActiveTabBadge();
  return res;
}

async function updateBookmark(id, patch) {
  return api(`/api/bookmarks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: patch,
  });
}

async function getBookmark(id) {
  return api(`/api/bookmarks/${encodeURIComponent(id)}`);
}

async function listBookmarks({ before, toread, starred } = {}) {
  const params = new URLSearchParams({ per_page: '20' });
  if (before) params.set('before', before);
  if (toread) params.set('toread', 'true');
  if (starred) params.set('starred', 'true');
  const result = await api('/api/bookmarks', { query: `?${params.toString()}` });
  return { ok: true, data: result.data || [], pagination: result.pagination || {} };
}

async function extractFromTab(tabId) {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    files: ['extract.js'],
  });
  const value = results && results[0] && results[0].result;
  if (!value) throw new Error('Konnte keine Metadaten aus der Seite lesen.');
  return value;
}

async function saveCurrentTab(tabId, extra = {}) {
  const meta = await extractFromTab(tabId);
  const bookmarkData = {
    url: meta.url,
    title: meta.title,
    summary: meta.summary,
    tags: meta.tags,
    ...extra,
  };
  if (!bookmarkData.note && meta.note) {
    bookmarkData.note = meta.note;
  }
  const result = await saveBookmark(bookmarkData, { meta: false });
  if (tabId) {
    await setSavedBadge(tabId, true);
  }
  return result;
}

function notify(message, title = 'Breadcrum') {
  try {
    browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon-96.png'),
      title,
      message,
    });
  } catch (_) {
    /* notifications not available */
  }
}

async function handleMessage(msg) {
  switch (msg && msg.type) {
    case 'save': {
      try {
        return await saveBookmark(msg.data || {}, {
          meta: Boolean(msg.meta),
          episode: Boolean(msg.episode),
        });
      } catch (err) {
        return friendlyError(err);
      }
    }
    case 'update': {
      try {
        const result = await updateBookmark(msg.id, msg.patch || {});
        return { ok: true, data: result && result.data };
      } catch (err) {
        return friendlyError(err);
      }
    }
    case 'delete': {
      try {
        await deleteBookmark(msg.id);
        return { ok: true };
      } catch (err) {
        return friendlyError(err);
      }
    }
    case 'get': {
      try {
        const result = await getBookmark(msg.id);
        return { ok: true, data: result };
      } catch (err) {
        return friendlyError(err);
      }
    }
    case 'list': {
      try {
        return await listBookmarks({
          before: msg.before,
          toread: msg.toread,
          starred: msg.starred,
        });
      } catch (err) {
        return friendlyError(err);
      }
    }
    case 'check-url': {
      const res = await checkUrlSaved(msg.url);
      return { ok: true, ...res };
    }
    case 'update-badge': {
      if (msg.tabId && msg.url) {
        if (msg.saved !== undefined) {
          urlStatusCache.set(msg.url, { saved: Boolean(msg.saved), id: msg.id || null, ts: Date.now() });
          await setSavedBadge(msg.tabId, Boolean(msg.saved));
        } else {
          await updateTabBadge(msg.tabId, msg.url);
        }
      }
      return { ok: true };
    }
    case 'extract': {
      try {
        const meta = await extractFromTab(msg.tabId);
        return { ok: true, data: meta };
      } catch (err) {
        return { ok: false, message: 'Diese Seite kann nicht gelesen werden (z. B. about:-Seiten).' };
      }
    }
    case 'get-token':
      return { ok: true, token: await getToken() };
    case 'set-token':
      await browser.storage.local.set({ token: String(msg.token || '').trim() });
      urlStatusCache.clear();
      refreshActiveTabBadge();
      return { ok: true };
    case 'validate-token': {
      try {
        await api('/api/bookmarks', { query: '?per_page=1' });
        return { ok: true };
      } catch (err) {
        return friendlyError(err);
      }
    }
    case 'open-tab':
      if (msg.url) {
        await browser.tabs.create({ url: msg.url });
      }
      return { ok: true };
    default:
      return { ok: false, message: 'Unbekannte Nachricht' };
  }
}

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse(friendlyError(err)));
  return true;
});

async function installMenus() {
  try {
    browser.contextMenus.removeAll();
  } catch (_) {
    /* not yet installed */
  }

  browser.contextMenus.create({
    id: 'breadcrum-save-page',
    title: 'Seite zu Breadcrum speichern',
    contexts: ['page', 'selection'],
  });

  browser.contextMenus.create({
    id: 'breadcrum-save-link',
    title: 'Link zu Breadcrum speichern',
    contexts: ['link'],
  });
}

browser.runtime.onInstalled.addListener(() => {
  installMenus();
  refreshActiveTabBadge();
});
installMenus();
refreshActiveTabBadge();

browser.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      await updateTabBadge(tab.id, tab.url);
    }
  } catch (_) {}
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    const targetUrl = changeInfo.url || tab?.url;
    if (targetUrl) {
      updateTabBadge(tabId, targetUrl);
    }
  }
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'breadcrum-save-link' && info.linkUrl) {
      const result = await saveBookmark(
        { url: info.linkUrl, title: '', summary: '', tags: [] },
        { meta: true }
      );
      notify(result.message);
    } else if (info.menuItemId === 'breadcrum-save-page' && tab && tab.id != null) {
      const extra = {};
      if (info.selectionText && info.selectionText.trim()) {
        extra.note = `„${info.selectionText.trim()}“`;
      }
      const result = await saveCurrentTab(tab.id, extra);
      if (tab.url) updateTabBadge(tab.id, tab.url);
      notify(result.message);
    }
  } catch (err) {
    notify(friendlyError(err).message, 'Breadcrum Fehler');
  }
});

browser.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-page') return;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    const result = await saveCurrentTab(tab.id);
    if (tab.url) updateTabBadge(tab.id, tab.url);
    notify(result.message);
  } catch (err) {
    notify(friendlyError(err).message, 'Breadcrum Fehler');
  }
});
