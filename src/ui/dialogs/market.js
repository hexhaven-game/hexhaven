// Haven market: sell and buy goods for gold.
import { TRADE_RES, RES_INFO } from '../../core/data.js';

import { svg } from '../../ui/icons.js';
import { game, human, hooks } from '../app.js';
import { amount, openModal, closeModal } from '../dom.js';



export function showMarket() {
  const pid = human().id;
  const draw = (card) => {
    const p = human();
    const conn = game.connected(pid);
    card.innerHTML = `
      <h2>Haven market</h2>
      <p class="note">${conn ? 'Your land borders Haven, so you get the full price.' : 'Your land doesn’t reach Haven yet: selling costs 1 gold transport each.'}</p>
      <table class="market">
        <tr><th></th><th>you have</th><th>sell</th><th>buy</th><th></th></tr>
        ${TRADE_RES.map((r) => `<tr>
            <td>${svg(r)} ${RES_INFO[r].name}</td>
            <td>${p.res[r]}</td>
            <td>${game.sellPrice(pid, r)}</td>
            <td>${game.buyPrice(r, pid)}</td>
            <td class="btncell">
              <button class="small" data-sell="${r}" ${p.res[r] ? '' : 'disabled'}>Sell</button>
              <button class="small ghost" data-sellall="${r}" ${p.res[r] > 1 ? '' : 'disabled'}>All</button>
              <button class="small" data-buy="${r}" ${p.res.gold >= game.buyPrice(r, pid) ? '' : 'disabled'}>Buy</button>
            </td></tr>`).join('')}
      </table>
      <p class="note">You have ${amount({ gold: p.res.gold })}. Prices drop when a lot is sold and recover each round.</p>
      <div class="actions"><button class="primary" data-x="close">Close</button></div>`;
  };
  openModal('', (card) => {
    draw(card);
    card.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.x) return closeModal();
      if (b.dataset.sell) game.sell(pid, b.dataset.sell, 1);
      if (b.dataset.sellall) game.sell(pid, b.dataset.sellall, human().res[b.dataset.sellall]);
      if (b.dataset.buy) game.buy(pid, b.dataset.buy, 1);
      draw(card);
    };
  }, { wide: true, onClose: () => { hooks.refreshHighlights(); hooks.render(); } });
}
