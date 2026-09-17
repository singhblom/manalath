import { CID } from 'multiformats/cid';

export type FirstMover = 'challenger' | 'opponent' | 'random';

/**
 * Who takes seat 0 (first ply after the root) once a match is accepted. `random` is decided by
 * the accept record's CID, which neither party can predict before the accept is written.
 */
export function resolveFirstMover(firstMover: FirstMover, acceptCid: string): 'challenger' | 'opponent' {
  if (firstMover !== 'random') return firstMover;
  const bytes = CID.parse(acceptCid).bytes;
  return bytes[bytes.length - 1] % 2 === 0 ? 'challenger' : 'opponent';
}
