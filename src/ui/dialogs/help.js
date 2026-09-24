// How to play.
import { WIN_GOAL } from '../../core/data.js';



import { openModal, closeModal } from '../dom.js';



export function showHelp() {
  openModal(`
    <h2>How to play</h2>
    <ol class="rules">
      <li>Each round, pick one of three tiles and place it against your own land. Matching neighbours earn extra prosperity.</li>
      <li>Then spend your actions: plant, build, scout, hire a guard or attack a bandit camp.</li>
      <li>Trading and the Haven market are free. Haven always has two open orders.</li>
      <li>Some tiles come with a goal flag: grow that area to the number shown for prosperity and a bonus tile.</li>
      <li>A lake next to a field makes crops grow a round faster. Nothing grows in winter.</li>
      <li>Grow your farm into a homestead, manor, village and finally a town for more actions and income.</li>
      <li>Buildings can be improved once for a little extra, and your farm's workshop unlocks small personal perks as it grows.</li>
      <li>At the end of each year the harvest fair rewards whoever filled the most orders.</li>
      <li>Spare gold buys extra tiles, one per round, a little pricier each time.</li>
      <li>First to ${WIN_GOAL} prosperity wins. Otherwise the leader after two years wins. Gold only breaks ties.</li>
    </ol>
    <p class="note">Keys: 1 2 3 pick a tile · E end turn · M market · T trade · I economy · Esc menu</p>
    <div class="actions"><button class="primary" data-x="close">Got it</button></div>`, (card) => {
    card.querySelector('[data-x]').onclick = closeModal;
  });
}
