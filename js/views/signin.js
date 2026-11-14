// Signing in, and making or joining a household.
import * as S from '../store.js?v=13';
import { icon } from '../ui.js?v=13';
import { st, esc, head, run, toast, gate, actions } from '../core.js?v=13';

const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
gate.signIn = () => {
  const f = (ic, kind, title, text) => `<li><span class="tile ${kind}">${icon(ic)}</span><span class="grow"><b>${title}</b><span>${text}</span></span></li>`;
  return `<div class="signin"><img class="logo" src="icon.svg" alt="">
    <h1>Weekly Shop</h1><p class="lede">Plan dinners together and send one shop to Sainsbury's whenever you need it.</p>
    <ul class="list card features">
      ${f('sparkle', 'other', 'Meal ideas that learn', 'Ten ideas whenever you shop, shaped by what you pick.')}
      ${f('list', 'veg', 'One shared list', 'Add things from either phone. It updates live.')}
      ${f('lock', 'fish', 'You approve every order', 'See the total before anything is paid for.')}
    </ul>
    <button class="btn primary lg block gbtn" data-act="signIn" style="background:var(--surface);color:var(--text);box-shadow:var(--shadow-1)">${GOOGLE} Continue with Google</button>
    ${S.emulator ? `<form data-form="testSignIn" class="card" style="margin-top:20px;text-align:left"><p class="tiny muted">Emulator test sign-in</p>
      <input type="text" name="name" placeholder="Name"><input type="text" name="email" placeholder="Email" style="margin-top:8px"><button class="btn block" style="margin-top:8px">Test sign in</button></form>` : ''}</div>`;
};
actions.signIn = () => run(S.signIn);
actions.testSignIn = f => run(async () => { await S.testSignIn(f.name.value, f.email.value); location.reload(); });

const inviteFromUrl = () => new URLSearchParams(location.search).get('join');
let closed = false;
gate.setup = () => {
  const code = inviteFromUrl();
  if (code) {
    return `${head('Join a household', { eyebrow: 'Invite', sub: 'You\'ve been invited to share a weekly shop.' })}
      <div class="card"><div class="row nowrap" style="gap:14px"><span class="tile veg">${icon('users')}</span><h3 id="inviteName" class="grow">Checking the invite…</h3></div>
      <button class="btn primary lg block" style="margin-top:16px" data-act="join">Join</button></div>
      <p class="small muted" style="margin:0 4px">Signed in as ${esc(st.user.email)}. <button class="link" data-act="signOut">Not you?</button></p>${checkInvite(code)}`;
  }
  // The app is only for the households it was set up for (firestore.rules: config/open).
  if (closed) {
    return `${head('This app is private', { eyebrow: 'Welcome', sub: 'Weekly Shop is set up for one household. To join it, ask someone in it for the invite link (Settings › Share invite link) and open it on this phone.' })}
      <p class="small muted" style="margin:0 4px">Signed in as ${esc(st.user.email)}. <button class="link" data-act="signOut">Sign out</button></p>`;
  }
  return `${head('Set up your household', { eyebrow: 'Welcome', sub: 'Make a household, then send the invite link to whoever you shop with.' })}
    <form class="card" data-form="create">
      <label class="field">Household name<input type="text" name="name" value="${esc((st.user.displayName || '').split(' ').pop() || 'Our')} household" required></label>
      <button class="btn primary lg block">Create household</button>
    </form>
    <p class="small muted" style="margin:0 4px">Got an invite link? Open it on this phone to join instead.<br>Signed in as ${esc(st.user.email)}. <button class="link" data-act="signOut">Sign out</button></p>`;
};
function checkInvite(code) {
  S.lookupInvite(code).then(inv => {
    const el = document.getElementById('inviteName');
    if (el) el.textContent = inv ? `Join “${inv.name}”?` : 'This invite link has expired. Ask for a new one.';
  }).catch(() => {});
  return '';
}
actions.create = async f => {
  try { await S.createHousehold(f.name.value.trim() || 'Our household'); }
  catch (e) {
    if (e?.code === 'permission-denied') { closed = true; document.getElementById('main').innerHTML = gate.setup(); return; }
    toast(e.message || 'Something went wrong');
  }
};
actions.join = () => run(async () => { await S.joinHousehold(inviteFromUrl()); history.replaceState(null, '', location.pathname + '#/week'); }, 'Joined');
actions.signOut = () => run(S.signOut);
