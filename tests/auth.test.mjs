import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerUser,
  loginUser,
  loginWithGoogle,
  logoutUser,
  getCurrentUser,
  listUsers,
  switchAccount,
  hashPassword,
  GUEST_USER
} from '../src/lib/auth.js';

// Mock localStorage for Node test runner
const memoryStore = new Map();
globalThis.localStorage = {
  getItem: (k) => memoryStore.get(k) || null,
  setItem: (k, v) => memoryStore.set(k, String(v)),
  removeItem: (k) => memoryStore.delete(k),
  clear: () => memoryStore.clear()
};

test('hashPassword produces deterministic output for same salt and password', async () => {
  const hash1 = await hashPassword('pass123', 'salt1');
  const hash2 = await hashPassword('pass123', 'salt1');
  const hash3 = await hashPassword('pass123', 'salt2');
  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
});

test('registerUser creates a new user and sets session', async () => {
  memoryStore.clear();
  const res = await registerUser({ username: 'ahmed', email: 'ahmed@study.com', password: '123' });
  assert.equal(res.ok, true);
  assert.equal(res.user.username, 'ahmed');
  assert.equal(res.user.provider, 'local');

  const current = getCurrentUser();
  assert.equal(current.id, res.user.id);
  assert.equal(current.username, 'ahmed');
});

test('registerUser rejects duplicate username', async () => {
  const res = await registerUser({ username: 'ahmed', email: 'other@study.com', password: '456' });
  assert.equal(res.ok, false);
  assert.match(res.error, /already taken/i);
});

test('loginUser authenticates with username or email and validates password', async () => {
  const goodLogin = await loginUser({ identifier: 'ahmed', password: '123' });
  assert.equal(goodLogin.ok, true);
  assert.equal(goodLogin.user.username, 'ahmed');

  const emailLogin = await loginUser({ identifier: 'ahmed@study.com', password: '123' });
  assert.equal(emailLogin.ok, true);

  const badPass = await loginUser({ identifier: 'ahmed', password: 'wrong' });
  assert.equal(badPass.ok, false);
  assert.match(badPass.error, /invalid password/i);
});

test('loginWithGoogle authenticates or registers Google account', () => {
  const gRes = loginWithGoogle({ email: 'scholar@gmail.com', name: 'Dr. Scholar' });
  assert.equal(gRes.ok, true);
  assert.equal(gRes.user.email, 'scholar@gmail.com');
  assert.equal(gRes.user.provider, 'google');

  const current = getCurrentUser();
  assert.equal(current.email, 'scholar@gmail.com');
});

test('listUsers lists all accounts on device', () => {
  const accounts = listUsers();
  assert.ok(accounts.length >= 2);
  assert.ok(!accounts[0].passwordHash); // never leaks password hash
});

test('switchAccount and logoutUser switch active profile', () => {
  const users = listUsers();
  const switched = switchAccount(users[0].id);
  assert.equal(getCurrentUser().id, users[0].id);

  logoutUser();
  assert.equal(getCurrentUser().id, GUEST_USER.id);
});
