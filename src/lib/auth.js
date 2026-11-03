// StudyOS Authentication & Multi-User Profile System (plan Phase 5).
// Local-first credential system with simple password rules, Google Sign-In,
// and user database isolation/partitioning.

const USERS_KEY = 'studyos.auth.users';
const SESSION_KEY = 'studyos.auth.session';

export const GUEST_USER = {
  id: 'guest',
  username: 'guest',
  name: 'Guest User',
  email: '',
  provider: 'guest',
  avatar: '',
  createdAt: 0
};

// --- Storage Helpers ---
function readUsers() {
  try {
    const raw = globalThis.localStorage?.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeUsers(list) {
  try {
    globalThis.localStorage?.setItem(USERS_KEY, JSON.stringify(list));
  } catch {}
  return list;
}

export function readSessionUserId() {
  try {
    return globalThis.localStorage?.getItem(SESSION_KEY) || 'guest';
  } catch {
    return 'guest';
  }
}

export function writeSessionUserId(userId) {
  try {
    if (userId) globalThis.localStorage?.setItem(SESSION_KEY, userId);
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {}
}

// --- Crypto & Password Hashing ---
export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}`);
  if (globalThis.crypto?.subtle) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Node / fallback simple hash
  let h = 0;
  for (let i = 0; i < data.length; i++) h = (h * 31 + data[i]) >>> 0;
  return h.toString(16);
}

function generateSalt() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- Auth Operations ---

export function listUsers() {
  return readUsers().map(({ passwordHash, salt, ...rest }) => rest);
}

export function getCurrentUser() {
  const currentId = readSessionUserId();
  if (!currentId || currentId === 'guest') return GUEST_USER;
  const users = readUsers();
  const user = users.find((u) => u.id === currentId);
  if (!user) return GUEST_USER;
  const { passwordHash, salt, ...safe } = user;
  return safe;
}

export async function registerUser({ username, email, password, name }) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  if (!cleanUsername || cleanUsername.length < 2) {
    return { ok: false, error: 'Username must be at least 2 characters' };
  }
  if (!cleanPassword || cleanPassword.length < 3) {
    return { ok: false, error: 'Password must be at least 3 characters' };
  }

  const users = readUsers();
  if (users.some((u) => u.username.toLowerCase() === cleanUsername)) {
    return { ok: false, error: 'Username is already taken' };
  }
  if (cleanEmail && users.some((u) => u.email && u.email.toLowerCase() === cleanEmail)) {
    return { ok: false, error: 'Email is already registered' };
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(cleanPassword, salt);
  const now = Date.now();

  const newUser = {
    id: `usr_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`,
    username: cleanUsername,
    name: name?.trim() || cleanUsername,
    email: cleanEmail,
    passwordHash,
    salt,
    provider: 'local',
    avatar: '',
    createdAt: now,
    lastLoginAt: now
  };

  users.push(newUser);
  writeUsers(users);
  writeSessionUserId(newUser.id);

  const { passwordHash: _, salt: __, ...safe } = newUser;
  return { ok: true, user: safe };
}

export async function loginUser({ identifier, password }) {
  const cleanId = String(identifier || '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  const users = readUsers();
  const user = users.find(
    (u) => u.username.toLowerCase() === cleanId || (u.email && u.email.toLowerCase() === cleanId)
  );

  if (!user) {
    return { ok: false, error: 'User not found' };
  }

  const hash = await hashPassword(cleanPassword, user.salt);
  if (hash !== user.passwordHash) {
    return { ok: false, error: 'Invalid password' };
  }

  user.lastLoginAt = Date.now();
  writeUsers(users);
  writeSessionUserId(user.id);

  const { passwordHash: _, salt: __, ...safe } = user;
  return { ok: true, user: safe };
}

export function loginWithGoogle({ email, name, avatar } = {}) {
  const users = readUsers();
  const cleanEmail = String(email || 'student@gmail.com').trim().toLowerCase();
  const displayName = name || cleanEmail.split('@')[0] || 'Google User';

  let user = users.find((u) => u.email && u.email.toLowerCase() === cleanEmail);

  if (!user) {
    user = {
      id: `usr_g_${Math.random().toString(36).slice(2)}`,
      username: displayName.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      name: displayName,
      email: cleanEmail,
      provider: 'google',
      avatar: avatar || '',
      createdAt: Date.now(),
      lastLoginAt: Date.now()
    };
    users.push(user);
  } else {
    user.lastLoginAt = Date.now();
    if (avatar) user.avatar = avatar;
  }

  writeUsers(users);
  writeSessionUserId(user.id);

  const { passwordHash, salt, ...safe } = user;
  return { ok: true, user: safe };
}

export function switchAccount(userId) {
  const users = readUsers();
  const found = users.find((u) => u.id === userId);
  if (found) {
    writeSessionUserId(found.id);
    const { passwordHash, salt, ...safe } = found;
    return safe;
  }
  writeSessionUserId('guest');
  return GUEST_USER;
}

export function logoutUser() {
  writeSessionUserId('guest');
  return { ok: true, user: GUEST_USER };
}

export function getUserDataPrefix(userId) {
  const id = userId || readSessionUserId();
  return id && id !== 'guest' ? `u_${id}:` : '';
}
