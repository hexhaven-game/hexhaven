// The changelog popup, read from the same CHANGELOG.md that lives in the repo root.




import { openModal, closeModal } from './dom.js';

import changelogMd from '../../CHANGELOG.md?raw';

export function parseChangelog(md) {
  const releases = [];
  let rel = null;
  let sec = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const v = line.match(/^##\s+([\d.]+)\s*[—-]\s*(.+)$/);
    if (v) {
      rel = { version: v[1], date: v[2].trim(), sections: [] };
      releases.push(rel);
      sec = null;
      continue;
    }
    const h = line.match(/^###\s+(.+)$/);
    if (h && rel) {
      sec = { title: h[1].trim(), items: [] };
      rel.sections.push(sec);
      continue;
    }
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item && sec) sec.items.push(item[1]);
  }
  return releases;
}

export const RELEASES = parseChangelog(changelogMd);

export const APP_VERSION = RELEASES[0]?.version ?? '0';

export function showChangelog() {
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // dates are written Dutch-style (dd-mm-yyyy) in CHANGELOG.md and shown as-is
  const fmtDate = (d) => d;
  const kind = (title) => ({ new: 'new', improved: 'improved', fixed: 'fixed', fix: 'fixed' }[title.toLowerCase()] || 'other');
  const release = (r) => `
    <div class="rel-head"><b>Version ${r.version}</b><span>${fmtDate(r.date)}</span></div>
    ${r.sections.map((sec) => `
      <div class="rel-sec">
        <span class="rel-tag ${kind(sec.title)}">${esc(sec.title)}</span>
        <ul>${sec.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </div>`).join('')}`;
  openModal(`
    <h2>What's new</h2>
    <div class="changelog">
      ${RELEASES.length ? release(RELEASES[0]) : '<p class="note">No changes recorded yet.</p>'}
      ${RELEASES.slice(1).map((r) => `<details class="rel-old"><summary><i class="chev" aria-hidden="true"></i>Version ${r.version} <span>${fmtDate(r.date)}</span></summary>${release(r)}</details>`).join('')}
    </div>
    <div class="actions"><button class="primary" data-x="close">Close</button></div>`, (card) => {
    card.querySelector('[data-x]').onclick = closeModal;
  }, { wide: true });
}
