// Data layer: Firebase Auth (Google) and Firestore, with live updates so both
// people see changes straight away.
//
// Firestore layout (see firestore.rules):
//   shopUsers/{uid}                 { householdId, name }
//   invites/{code}                  { hid, name }
//   households/{hid}                { name, members[], memberNames{uid:name}, inviteCode, store, createdAt }
//   households/{hid}/meals/{id}     { name, tags[], ingredients[{item, search, qty, uid?}], timesChosen, lastChosen, lastOffered, archived }
//   households/{hid}/weeks/{sunday} { offered[mealId], picks{mealId: uid}, deliveryDate, extras{lineKey: bool}, status }
//   households/{hid}/list/{id}      { text, qty, addedBy, addedAt, done }
//   households/{hid}/staples/{id}   { product_uid, name, rule, quantity, every_days, last_bought, dropped }
//   households/{hid}/orders/{id}    order run, driven by worker/run.mjs:
//        { week, deliveryDate, state, requestedBy, lines[], smsCode, slots[], slotChoice, total, approvedBy, error, log[] }

import {
  initializeApp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut as fbSignOut, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, orderBy, limit, onSnapshot, serverTimestamp,
  arrayUnion, deleteField, writeBatch, connectFirestoreEmulator,
} from '../vendor/firebase.js';
import { FIREBASE_CONFIG } from './config.js';

export const emulator = new URLSearchParams(location.search).has('emulator');
const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
export const db = initializeFirestore(app, emulator ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
if (emulator) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8081);
}

export { serverTimestamp, deleteField, arrayUnion };

const state = { user: null, profile: null, household: null, meals: [], list: [], staples: [], weeks: {}, orders: [], ready: false };
const listeners = new Set();
let unsubs = [];
const emit = () => listeners.forEach(fn => fn(state));
export const onChange = fn => { listeners.add(fn); fn(state); return () => listeners.delete(fn); };
export const getState = () => state;

const hpath = (...p) => ['households', state.household.id, ...p].join('/');
const randomCode = (n = 12) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

export async function signIn() {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) { if (/popup/.test(e.code || '')) await signInWithRedirect(auth, provider); else throw e; }
}
export const signOut = () => fbSignOut(auth);

// Emulator only (?emulator): Google sign-in needs Google's servers, so tests sign in with a made-up email.
export async function testSignIn(name, email) {
  if (!emulator) throw new Error('Only for the emulator');
  const cred = await createUserWithEmailAndPassword(auth, email, 'password').catch(() => signInWithEmailAndPassword(auth, email, 'password'));
  if (!cred.user.displayName) { await updateProfile(cred.user, { displayName: name }); await cred.user.reload(); }
}

getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, async (u) => {
  unsubs.forEach(f => f()); unsubs = [];
  Object.assign(state, { user: u, profile: null, household: null, meals: [], list: [], staples: [], weeks: {}, orders: [], ready: !u });
  emit();
  if (!u) return;
  unsubs.push(onSnapshot(doc(db, 'shopUsers', u.uid), snap => {
    state.profile = snap.exists() ? snap.data() : {};
    const hid = state.profile.householdId;
    if (hid && hid !== state.household?.id) watchHousehold(hid);
    if (!hid) { state.ready = true; emit(); }
  }, err => { state.error = err.message; state.ready = true; emit(); }));
});

function watchHousehold(hid) {
  unsubs.slice(1).forEach(f => f()); unsubs = unsubs.slice(0, 1);
  state.household = { id: hid };
  const h = (...p) => ['households', hid, ...p].join('/');
  const coll = (name, key, sort) => onSnapshot(query(collection(db, h(name)), ...(sort ? [orderBy(sort[0], sort[1])] : [])), snap => {
    state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit();
  }, err => { state.error = err.message; emit(); });
  unsubs.push(onSnapshot(doc(db, h()), snap => {
    if (!snap.exists()) { state.household = null; state.ready = true; emit(); return; }
    state.household = { id: hid, ...snap.data() }; state.ready = true; emit();
  }, err => { state.error = err.message; state.ready = true; emit(); }));
  unsubs.push(coll('meals', 'meals'));
  unsubs.push(coll('list', 'list', ['addedAt', 'asc']));
  unsubs.push(coll('staples', 'staples'));
  unsubs.push(onSnapshot(query(collection(db, h('weeks')), orderBy('createdAt', 'desc'), limit(8)), snap => {
    state.weeks = Object.fromEntries(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }])); emit();
  }));
  unsubs.push(onSnapshot(query(collection(db, h('orders')), orderBy('createdAt', 'desc'), limit(10)), snap => {
    state.orders = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit();
  }));
}

const myName = () => state.user?.displayName?.split(' ')[0] || state.user?.email || 'Someone';

export async function createHousehold(name) {
  const u = state.user;
  const inviteCode = randomCode();
  const ref = doc(collection(db, 'households'));
  await setDoc(ref, { name, members: [u.uid], memberNames: { [u.uid]: myName() }, inviteCode, store: '0031', createdAt: serverTimestamp() });
  await setDoc(doc(db, 'invites', inviteCode), { hid: ref.id, name });
  await setDoc(doc(db, 'shopUsers', u.uid), { householdId: ref.id, name: myName() }, { merge: true });
}

export async function lookupInvite(code) {
  const snap = await getDoc(doc(db, 'invites', code));
  return snap.exists() ? snap.data() : null;
}

export async function joinHousehold(code) {
  const inv = await lookupInvite(code);
  if (!inv) throw new Error('That invite link has expired. Ask for a new one.');
  const u = state.user;
  const ref = doc(db, 'households', inv.hid);
  // We can't read the household before joining, so send the whole new members list via arrayUnion.
  await updateDoc(ref, { members: arrayUnion(u.uid), [`memberNames.${u.uid}`]: myName(), joinCode: code });
  await setDoc(doc(db, 'shopUsers', u.uid), { householdId: inv.hid, name: myName() }, { merge: true });
}

export async function newInviteCode() {
  const old = state.household.inviteCode;
  const code = randomCode();
  await updateDoc(doc(db, hpath()), { inviteCode: code });
  await setDoc(doc(db, 'invites', code), { hid: state.household.id, name: state.household.name });
  if (old) await deleteDoc(doc(db, 'invites', old)).catch(() => {});
  return code;
}

// Generic writes under the household.
export const setH = (path, data, merge = true) => setDoc(doc(db, hpath(...path)), data, { merge });
export const updateH = (path, data) => updateDoc(doc(db, hpath(...path)), data);
export const addH = (path, data) => addDoc(collection(db, hpath(...path)), data);
export const deleteH = (path) => deleteDoc(doc(db, hpath(...path)));
export async function batchH(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    for (const [kind, path, data] of ops.slice(i, i + 400)) {
      const ref = kind === 'add' ? doc(collection(db, hpath(...path))) : doc(db, hpath(...path));
      if (kind === 'delete') b.delete(ref); else b.set(ref, data, { merge: true });
    }
    await b.commit();
  }
}
export const me = () => ({ uid: state.user.uid, name: myName() });
