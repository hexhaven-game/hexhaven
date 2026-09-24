// Haven orders explained: what Haven wants, where to get it, what it pays.
import { RES_INFO } from '../../core/data.js';

import { svg } from '../../ui/icons.js';
import { game, human } from '../app.js';
import { amount, RES_COLOR, openModal, closeModal } from '../dom.js';



// where each good comes from, in words a new player can act on
export const RES_SOURCE = {
  wood: 'Forest tiles give 1 each round; a lumber camp on a forest gives 2 more.',
  stone: 'Mountain tiles give 1 each round; a quarry on a mountain gives 2 more.',
  wool: 'Meadow tiles give 1 each round.',
  grain: 'Sow wheat on a field; it is ready after 2 rounds.',
  veg: 'Sow carrots or pumpkins on a field.',
};

export function showOrdersHelp() {
  const h = human();
  openModal(`
    <h2>Haven orders</h2>
    <p class="note">Haven, the walled town in the middle, always wants two goods. Bring the full amount and it pays
      more gold than the market does, plus prosperity (the score that wins the game). Delivering is free: it doesn't use an action.</p>
    <div class="ohelp">${game.requests.map((q) => {
      const ok = h.res[q.res] >= q.amount;
      return `<div class="orow ${ok ? 'ok' : ''}">
        <div class="ot" style="--rc:${RES_COLOR[q.res]}">${svg(q.res)}<b>${q.amount} ${RES_INFO[q.res].name.toLowerCase()}</b>
          <span class="got">you have ${h.res[q.res]}</span>
          <span class="rw">${amount({ gold: q.gold })} ${svg('crown')}+${q.prosp}</span></div>
        <small>${ok ? 'Ready: tap Deliver in the orders card during your turn.' : `Short by ${q.amount - h.res[q.res]}. ${RES_SOURCE[q.res]} You can also trade for it.`}</small>
      </div>`;
    }).join('')}</div>
    <p class="note">When an order is filled, Haven posts a new one. Whoever fills the most orders in a year wins the harvest fair (+10 prosperity, runner-up +5).</p>
    <div class="actions"><button class="primary" data-close>Got it</button></div>`,
  (card) => card.querySelector('[data-close]').onclick = closeModal);
}
