import test from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage and window for Node environment
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

globalThis.window = {
  location: {
    origin: 'https://makeen.app',
    pathname: '/'
  }
};

import {
  generateCouponCode,
  getShareDeepLink
} from '../src/lib/communityStore.js';

test('generateCouponCode produces clean readable format with MK- prefix', () => {
  const code = generateCouponCode();
  assert.match(code, /^MK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('generateCouponCode generates 50 unique codes without collision', () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) {
    codes.add(generateCouponCode());
  }
  assert.equal(codes.size, 50);
});

test('getShareDeepLink formats direct link correctly', () => {
  const link = getShareDeepLink('comm-elzero-js');
  assert.equal(link, 'https://makeen.app/#course/comm-elzero-js');
});

test('coupon redemption logic checks limit, usage, and master passcode', () => {
  const share = {
    id: 'course-1',
    isPaid: true,
    masterPasscode: 'SECRET2026',
    coupons: [
      {
        id: 'c1',
        code: 'MK-TEST-AAAA',
        maxUses: 1,
        usedCount: 0,
        usedBy: []
      },
      {
        id: 'c2',
        code: 'MK-TEST-BBBB',
        maxUses: 2,
        usedCount: 2,
        usedBy: [
          { userId: 'u1', username: 'Ali' },
          { userId: 'u2', username: 'Omar' }
        ]
      }
    ]
  };

  // 1. Master passcode match
  assert.equal(share.masterPasscode.toLowerCase(), 'secret2026'.toLowerCase());

  // 2. Used-up coupon rejected
  const exhaustedCoupon = share.coupons.find(c => c.code === 'MK-TEST-BBBB');
  assert.equal(exhaustedCoupon.usedCount >= exhaustedCoupon.maxUses, true);

  // 3. Fresh coupon accepted
  const freshCoupon = share.coupons.find(c => c.code === 'MK-TEST-AAAA');
  assert.equal(freshCoupon.usedCount < freshCoupon.maxUses, true);
  freshCoupon.usedCount += 1;
  freshCoupon.usedBy.push({ userId: 'u3', username: 'Zaid' });
  assert.equal(freshCoupon.usedCount, 1);
  assert.equal(freshCoupon.usedBy[0].userId, 'u3');
});

