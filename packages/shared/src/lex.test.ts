import { describe, expect, test } from 'bun:test';
import { Match, Accept, Move } from './lex.js';

const ref = { uri: 'at://did:plc:abc123/top.manalath.match/3kabc', cid: 'bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' };
const now = '2026-09-11T08:00:00.000Z';

describe('top.manalath.match', () => {
  test('open untimed challenge', () => {
    const r = Match.validateRecord({ $type: 'top.manalath.match', firstMover: 'random', createdAt: now });
    expect(r.success).toBe(true);
  });
  test('forked blitz challenge', () => {
    const r = Match.validateRecord({
      $type: 'top.manalath.match', opponent: 'did:plc:xyz', firstMover: 'opponent',
      root: ref, timeControl: { base: 180, increment: 2 }, rated: false, createdAt: now,
    });
    expect(r.success).toBe(true);
  });
  test('rejects missing firstMover', () => {
    expect(Match.validateRecord({ $type: 'top.manalath.match', createdAt: now }).success).toBe(false);
  });
});

describe('top.manalath.accept', () => {
  test('valid', () => {
    expect(Accept.validateRecord({ $type: 'top.manalath.accept', match: ref, createdAt: now }).success).toBe(true);
  });
});

describe('top.manalath.move', () => {
  test('placement at ply 0', () => {
    const r = Move.validateRecord({
      $type: 'top.manalath.move', match: ref, ply: 0,
      action: { $type: 'top.manalath.move#place', q: 0, r: 0, color: 1 },
      clock: { remainingMs: 179000 }, createdAt: now,
    });
    expect(r.success).toBe(true);
  });
  test('pass with prev', () => {
    const r = Move.validateRecord({
      $type: 'top.manalath.move', match: ref, ply: 7, prev: ref,
      action: { $type: 'top.manalath.move#pass' }, createdAt: now,
    });
    expect(r.success).toBe(true);
  });
  test('rejects colour 3', () => {
    const r = Move.validateRecord({
      $type: 'top.manalath.move', match: ref, ply: 0,
      action: { $type: 'top.manalath.move#place', q: 0, r: 0, color: 3 }, createdAt: now,
    });
    expect(r.success).toBe(false);
  });
  test('rejects negative ply', () => {
    const r = Move.validateRecord({
      $type: 'top.manalath.move', match: ref, ply: -1,
      action: { $type: 'top.manalath.move#resign' }, createdAt: now,
    });
    expect(r.success).toBe(false);
  });
});
