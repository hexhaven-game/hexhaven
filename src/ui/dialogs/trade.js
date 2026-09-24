// Trading with the AI towns: your offers and theirs.
import { RES, RES_INFO } from '../../core/data.js';
import { respondToOffer } from '../../core/ai.js';
import { svg } from '../../ui/icons.js';
import { game, human, hooks } from '../app.js';
import { hexColor, amount, toast, openModal, closeModal } from '../dom.js';



export function showTrade() {
  const h = human();
  const give = {};
  const want = {};
  let responses = null;
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));
  const stepper = (side, r) => {
    const obj = side === 'give' ? give : want;
    const max = side === 'give' ? h.res[r] : 9;
    return `<div class="line"><span>${svg(r)} ${RES_INFO[r].name}${side === 'give' ? ` <small>${h.res[r]}</small>` : ''}</span>
      <span class="stepper"><button class="small ghost" data-s="${side}" data-r="${r}" data-d="-1" ${obj[r] ? '' : 'disabled'}>−</button>
      <b>${obj[r] || 0}</b>
      <button class="small ghost" data-s="${side}" data-r="${r}" data-d="1" ${(obj[r] || 0) < max ? '' : 'disabled'}>+</button></span></div>`;
  };
  const draw = (card) => {
    const g = clean(give);
    const w = clean(want);
    const valid = Object.keys(g).length && Object.keys(w).length;
    card.innerHTML = `
      <h2>Trade</h2>
      <div class="trade-grid">
        <div><h4>You give</h4>${RES.map((r) => stepper('give', r)).join('')}</div>
        <div><h4>You ask for</h4>${RES.map((r) => stepper('want', r)).join('')}</div>
      </div>
      <div class="actions">
        <button class="ghost" data-x="close">Close</button>
        <button class="primary" data-x="offer" ${valid ? '' : 'disabled'}>Make offer</button>
      </div>
      ${responses ? `<div class="responses">${responses.map((r, i) => {
        const ai = game.players[r.pid];
        const action = r.kind === 'accept'
          ? `<button class="primary small" data-accept="${i}">Trade</button>`
          : r.kind === 'counter'
            ? `<span class="counter">${amount(r.gives)} for ${amount(r.wants)}</span><button class="primary small" data-accept="${i}" ${game.canAfford(h, r.gives) ? '' : 'disabled'}>Accept</button>`
            : '<span class="no">no</span>';
        return `<div class="resp" style="--c:${hexColor(ai.color)}"><div><b>${ai.name}</b><span class="q">${r.text}</span></div><div class="ra">${action}</div></div>`;
      }).join('')}</div>` : ''}`;
  };
  openModal('', (card) => {
    draw(card);
    card.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.x === 'close') return closeModal();
      if (b.dataset.s) {
        const obj = b.dataset.s === 'give' ? give : want;
        obj[b.dataset.r] = Math.max(0, (obj[b.dataset.r] || 0) + Number(b.dataset.d));
        responses = null;
      }
      if (b.dataset.x === 'offer') {
        responses = game.players.filter((p) => p.isAI).map((ai) => ({ pid: ai.id, ...respondToOffer(game, ai, h, clean(give), clean(want)) }));
      }
      if (b.dataset.accept != null) {
        const r = responses[Number(b.dataset.accept)];
        if (game.trade(h.id, r.pid, r.gives, r.wants)) {
          closeModal();
          toast('Traded', `with ${game.players[r.pid].name}`, 1300);
          return;
        }
      }
      draw(card);
    };
  }, { wide: true, onClose: () => { hooks.refreshHighlights(); hooks.render(); } });
}

export function aiOfferModal(ai, prop) {
  return new Promise((resolve) => {
    openModal(`
      <h2><span class="dot" style="--c:${hexColor(ai.color)}"></span>${ai.name} wants to trade</h2>
      <div class="offer-box">
        <div><small>you get</small><b>${amount(prop.aiGives)}</b></div>
        <div class="arrow">${svg('trade')}</div>
        <div><small>you give</small><b>${amount(prop.aiWants)}</b></div>
      </div>
      <div class="actions">
        <button class="ghost" data-r="0">No thanks</button>
        <button class="primary" data-r="1">Trade</button>
      </div>`, (card) => {
      card.onclick = (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        closeModal({ silent: true });
        resolve(b.dataset.r === '1');
      };
    }, { onClose: () => resolve(false), noDim: true });
  });
}
