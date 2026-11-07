// src/lib/sessionStore.js — Internal Session, Gating, and Transactions Store
// Manages unlocked items, pending payment receipts, reviews, and user sessions.

import { getCurrentUser } from './auth.js';

const UNLOCKED_KEY = 'makeen.session.unlocked';
const ORDERS_KEY = 'makeen.session.orders';
const REVIEWS_KEY = 'makeen.session.reviews';

function getStorage(key, fallback = []) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setStorage(key, val) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(val));
  } catch {}
}

/**
 * Returns true if the user has access to this content (free, creator, or verified purchase).
 */
export function isContentUnlocked(share, user = null) {
  if (!share) return false;
  if (!share.isPaid || share.price <= 0) return true;

  const currentUser = user || getCurrentUser();
  if (!currentUser || currentUser.id === 'guest') {
    return false;
  }

  // Creator always has access to their own content
  if (share.creatorId && share.creatorId === currentUser.id) {
    return true;
  }

  const unlocked = getStorage(UNLOCKED_KEY, {});
  const userUnlocked = unlocked[currentUser.id] || [];
  return userUnlocked.includes(share.id);
}

/**
 * Unlocks a paid content item for a user after payment verification.
 */
export function unlockContentForUser(userId, shareId) {
  if (!userId || !shareId) return;
  const unlocked = getStorage(UNLOCKED_KEY, {});
  if (!unlocked[userId]) unlocked[userId] = [];
  if (!unlocked[userId].includes(shareId)) {
    unlocked[userId].push(shareId);
  }
  setStorage(UNLOCKED_KEY, unlocked);
}

/**
 * Submits a payment receipt for creator verification.
 */
export function submitPaymentOrder({ shareId, shareTitle, sharePrice, receiptImage, buyerNote = '' }) {
  const user = getCurrentUser();
  if (!user || user.id === 'guest') {
    throw new Error('AUTH_REQUIRED');
  }

  const orders = getStorage(ORDERS_KEY, []);
  const newOrder = {
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    shareId,
    shareTitle,
    sharePrice,
    buyerId: user.id,
    buyerName: user.name || user.username || 'طالب مَكِين',
    buyerEmail: user.email || '',
    buyerAvatar: user.avatar || '',
    receiptImage, // Base64 data URL
    buyerNote: buyerNote.trim(),
    status: 'pending', // 'pending' | 'accepted' | 'rejected'
    createdAt: Date.now()
  };

  orders.unshift(newOrder);
  setStorage(ORDERS_KEY, orders);
  return newOrder;
}

/**
 * Lists all orders/payment requests (can be filtered by creator or buyer).
 */
export function listOrders() {
  return getStorage(ORDERS_KEY, []);
}

/**
 * Verifies or rejects a payment order.
 */
export function updateOrderStatus(orderId, status) {
  const orders = getStorage(ORDERS_KEY, []);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return null;

  orders[idx].status = status;
  orders[idx].updatedAt = Date.now();
  setStorage(ORDERS_KEY, orders);

  if (status === 'accepted') {
    unlockContentForUser(orders[idx].buyerId, orders[idx].shareId);
  }

  return orders[idx];
}

/**
 * Adds a rating and review for a community share.
 */
export function addShareReview({ shareId, rating, comment }) {
  const user = getCurrentUser();
  const userName = user && user.id !== 'guest' ? (user.name || user.username) : 'طالب مَكِين';
  const reviews = getStorage(REVIEWS_KEY, []);
  const newReview = {
    id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    shareId,
    userId: user?.id || 'guest',
    userName,
    userAvatar: user?.avatar || '',
    rating: Math.max(1, Math.min(5, Number(rating) || 5)),
    comment: String(comment || '').trim(),
    createdAt: Date.now()
  };

  reviews.unshift(newReview);
  setStorage(REVIEWS_KEY, reviews);
  return newReview;
}

/**
 * Gets all reviews for a specific community share.
 */
export function getShareReviews(shareId) {
  const all = getStorage(REVIEWS_KEY, []);
  return all.filter((r) => r.shareId === shareId);
}
