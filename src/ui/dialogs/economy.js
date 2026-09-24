// Economy overview: stock, income per round and where it comes from.
import { RES, RES_INFO } from '../../core/data.js';

import { svg } from '../../ui/icons.js';
import { game, human } from '../app.js';
import { amount, RES_COLOR, openModal, closeModal } from '../dom.js';



export function showEconomy() {
  const h = human();
  const eco = game.economy(h.id);
  const soon = {};
  for (const c of eco.crops) {
    if (c.left <= 3) for (const [r, n] of Object.entries(c.yield)) soon[r] = (soon[r] || 0) + n;
  }
  const hist = eco.history;
  const maxW = Math.max(10, ...hist.map((x) => x.worth));
  // fixed-size bars (12 slots) so a short history doesn't stretch into blobs
  const bars = hist.length
    ? `<svg class="chart" viewBox="0 0 264 84">${hist.map((x, i) => {
      const bh = Math.max(3, (x.worth / maxW) * 54);
      return `<g><rect x="${i * 22 + 3}" y="${70 - bh}" width="16" height="${bh}" rx="3"><title>Round ${x.round}: worth ${x.worth} gold</title></rect>
        <text x="${i * 22 + 11}" y="${64 - bh}" text-anchor="middle">${Math.round(x.worth)}</text>
        <text x="${i * 22 + 11}" y="82" text-anchor="middle" class="r">${x.round}</text></g>`;
    }).join('')}</svg>`
    : '<p class="note">Your income appears here after the first harvest.</p>';
  const trend = hist.length >= 2 ? hist[hist.length - 1].worth - hist[hist.length - 2].worth : 0;
  const perRound = RES.reduce((s, r) => s + (eco.income[r] || 0) * (r === 'gold' ? 1 : game.market[r].p), 0);
  openModal(`
    <h2>Your economy</h2>
    <div class="eco-top">
      <div><small>stock is worth</small><b>${Math.round(eco.value)}</b>${svg('gold')}</div>
      <div><small>income per round</small><b>${Math.round(perRound)}</b>${svg('gold')}</div>
      <div><small>vs previous round</small><b class="${trend >= 0 ? 'good' : 'bad'}">${trend >= 0 ? '+' : '−'}${Math.abs(Math.round(trend))}</b></div>
    </div>
    <table class="eco">
      <tr><th></th><th>have</th><th>each round</th><th>from crops soon</th><th>sells for</th></tr>
      ${RES.map((r) => `<tr>
        <td><span class="ico" style="--rc:${RES_COLOR[r]}">${svg(r)}</span>${RES_INFO[r].name}</td>
        <td><b>${h.res[r]}</b></td>
        <td class="${eco.income[r] ? 'good' : 'dim'}">${eco.income[r] ? `+${eco.income[r]}` : '–'}</td>
        <td class="${soon[r] ? '' : 'dim'}">${soon[r] ? `+${soon[r]}` : '–'}</td>
        <td class="dim">${r === 'gold' ? '' : game.sellPrice(h.id, r)}</td></tr>`).join('')}
    </table>
    <div class="eco-cols">
      <div>
        <h4>Where it comes from</h4>
        ${eco.sources.length ? eco.sources.map((src) => `<div class="src"><span>${src.n > 1 ? `${src.n}× ` : ''}${src.label}</span><span>${amount(src.gives)}</span></div>`).join('') : '<p class="note">Nothing yet. Forests, meadows and mountains produce every round.</p>'}
      </div>
      <div>
        <h4>In the ground</h4>
        ${eco.crops.length ? eco.crops.map((c) => `<div class="src"><span>${c.name}</span><span>${c.left ? `${c.left} round${c.left > 1 ? 's' : ''}` : 'this round'} → ${amount(c.yield)}</span></div>`).join('') : '<p class="note">No crops planted. Click a field to plant.</p>'}
        <h4>Income per round</h4>
        ${bars}
        ${eco.bandits ? `<p class="note warn">${eco.bandits} bandit camp${eco.bandits > 1 ? 's' : ''} next to your land. Your guards stop ${Math.round(eco.block * 100)}% of raids.</p>` : ''}
      </div>
    </div>
    <div class="actions"><button class="primary" data-x="close">Close</button></div>`, (card) => {
    card.querySelector('[data-x]').onclick = closeModal;
  }, { wide: true });
}
