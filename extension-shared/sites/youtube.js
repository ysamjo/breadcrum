(() => {
  'use strict';

  // Breadcrum 1.6.0 – YouTube: externe Links direkt öffnen,
  // ohne Umweg über die /redirect-Warnseite.
  // Kein Breadcrum-Button mehr auf /watch (Speichern geht weiter
  // über Popup, Kontextmenü und Alt+Shift+B).

  const REDIRECT_PATH = '/redirect';

  function extractTarget(rawHref) {
    if (!rawHref) return null;
    let url;
    try {
      url = new URL(rawHref, location.href);
    } catch (_) {
      return null;
    }
    // Nur youtube-redirects anfassen, z. B.
    // /redirect?q=https://example.com…&redir_token=…&event=video_description
    if (!url.pathname.endsWith(REDIRECT_PATH)) return null;
    const q = url.searchParams.get('q');
    if (!q) return null;
    const target = q.trim();
    // Nur http(s) direkt öffnen – alles andere (z. B. javascript:) ignorieren.
    if (!/^https?:\/\//i.test(target)) return null;
    return target;
  }

  function fixAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return false;
    if (anchor.dataset.bcDirect === '1') return false;
    const raw = anchor.getAttribute('href');
    const target = extractTarget(raw || anchor.href);
    if (!target) return false;
    anchor.dataset.bcDirect = '1';
    try {
      anchor.href = target;
    } catch (_) {
      anchor.setAttribute('href', target);
    }
    // YouTube-eigene Klick-Tracker entfernen, damit kein Redirect re-gesetzt wird.
    for (const name of [...anchor.getAttributeNames()]) {
      if (name.startsWith('data-yt') || name === 'data-target-url') {
        anchor.removeAttribute(name);
      }
    }
    // Externe Links in neuem Tab, wie YouTube es auch tut.
    if (!anchor.getAttribute('target')) {
      anchor.setAttribute('target', '_blank');
    }
    anchor.setAttribute('rel', 'noopener noreferrer');
    return true;
  }

  function sweep(root) {
    const scope = root && root.querySelectorAll ? root : document;
    for (const a of scope.querySelectorAll('a[href*="/redirect"]')) {
      fixAnchor(a);
    }
    // Falls root selbst ein Link ist (addedNode-Fall).
    if (root instanceof HTMLAnchorElement) fixAnchor(root);
  }

  // 1) Falls wir selbst auf der Warnseite gelandet sind (z. B. Mittelklick
  // vor dem Rewrite, kopierter Link, No-JS-Fallback): sofort weiter.
  function forwardFromRedirectPage() {
    try {
      const url = new URL(location.href);
      if (!url.pathname.endsWith(REDIRECT_PATH)) return;
      const q = url.searchParams.get('q');
      if (q && /^https?:\/\//i.test(q.trim())) {
        location.replace(q.trim());
      }
    } catch (_) {
      /* kein Redirect – nichts tun */
    }
  }

  // 2) Fallback für Klicks, die noch auf /redirect zeigen (SPA-Player,
  // dynamisch nachgeladene Beschreibungen): direkt öffnen statt Warnseite.
  function onClickCapture(event) {
    if (event.defaultPrevented) return;
    // Nur Links behandeln, keine Modifier-Sonderfälle kaputtmachen? –
    // Auch mit Strg/Cmd/Mittelklick wollen wir direkt öffnen.
    const anchor = event.target && event.target.closest
      ? event.target.closest('a[href]')
      : null;
    if (!anchor) return;
    const raw = anchor.getAttribute('href') || anchor.href;
    const target = extractTarget(raw);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    // Markieren + umschreiben, damit Wiederholungsklicks normal laufen.
    fixAnchor(anchor);
    const openTarget = anchor.getAttribute('target') || '_blank';
    if (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey || openTarget === '_blank') {
      window.open(target, '_blank', 'noopener,noreferrer');
    } else {
      location.href = target;
    }
  }

  function onAuxClick(event) {
    // Mittelklick separat abfangen (öffnet sonst ggf. doch /redirect).
    if (event.button !== 1) return;
    const anchor = event.target && event.target.closest
      ? event.target.closest('a[href]')
      : null;
    if (!anchor) return;
    const target = extractTarget(anchor.getAttribute('href') || anchor.href);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    fixAnchor(anchor);
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  forwardFromRedirectPage();
  sweep(document);

  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('auxclick', onAuxClick, true);
  document.addEventListener('yt-navigate-finish', () => {
    forwardFromRedirectPage();
    sweep(document);
  });

  let scheduled = false;
  function scheduleSweep() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      forwardFromRedirectPage();
      sweep(document);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 50);
  }

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node instanceof HTMLAnchorElement) {
          fixAnchor(node);
        } else if (node.querySelectorAll) {
          // Schnellpfad: nur Teilbaum durchsuchen.
          for (const a of node.querySelectorAll('a[href*="/redirect"]')) {
            fixAnchor(a);
          }
        }
      }
      if (m.type === 'attributes' && m.target instanceof HTMLAnchorElement) {
        fixAnchor(m.target);
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });

  // SPA-Navigation ohne Observer-Lücke abdecken.
  document.addEventListener('yt-page-data-updated', scheduleSweep);
  window.addEventListener('popstate', scheduleSweep);
  scheduleSweep();
})();
