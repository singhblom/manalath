/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../lexicons'
import { type $Typed, is$typed as _is$typed, type OmitKey } from '../../../util'
import type * as ComAtprotoRepoStrongRef from '../../com/atproto/repo/strongRef.js'
import type * as TopManalathDefs from './defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'top.manalath.match'

export interface Main {
  $type: 'top.manalath.match'
  /** The player being challenged. Absent for an open challenge that anyone may accept. */
  opponent?: string
  /** Who plays the first ply after `root`. `random` is resolved from the accept record's CID: if the last byte of the CID is even the challenger moves first, otherwise the opponent. */
  firstMover: 'challenger' | 'opponent' | 'random' | (string & {})
  root?: ComAtprotoRepoStrongRef.Main
  rules?: TopManalathDefs.Rules
  timeControl?: TopManalathDefs.TimeControl
  rated: boolean
  /** A game server both players agree to have run this match live. Not evidence in itself: an indexer treats the match as arbitrated only if this DID's repo holds a verdict record referencing this match by CID. Absent for self-reported games. */
  arbiter?: string
  createdAt: string
  [k: string]: unknown
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain, true)
}

export {
  type Main as Record,
  isMain as isRecord,
  validateMain as validateRecord,
}
