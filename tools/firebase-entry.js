// The parts of the Firebase JS SDK the app uses, bundled into vendor/firebase.js (no CDN, no build step).
// Rebuild: npm i firebase esbuild && npx esbuild tools/firebase-entry.js --bundle --format=esm --minify --target=es2020 --legal-comments=none --outfile=vendor/firebase.js
export { initializeApp } from 'firebase/app';
export { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
export { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, onSnapshot, writeBatch, serverTimestamp, arrayUnion, deleteField, increment, connectFirestoreEmulator } from 'firebase/firestore';
