/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../lexicons'
import { type $Typed, is$typed as _is$typed, type OmitKey } from '../../../util'

const is$typed = _is$typed,
  validate = _validate
const id = 'top.manalath.defs'

/** Fischer clock: each player starts with `base` seconds and gains `increment` seconds per move. */
export interface TimeControl {
  $type?: 'top.manalath.defs#timeControl'
  /** Initial time per player in seconds. */
  base: number
  /** Time added after each of a player's moves, in seconds. */
  increment: number
}

const hashTimeControl = 'timeControl'

export function isTimeControl<V>(v: V) {
  return is$typed(v, id, hashTimeControl)
}

export function validateTimeControl<V>(v: V) {
  return validate<TimeControl & V>(v, id, hashTimeControl)
}

/** Board and rule variant. Only the standard 61-cell board (radius 4) is defined so far. */
export interface Rules {
  $type?: 'top.manalath.defs#rules'
  boardRadius: number
}

const hashRules = 'rules'

export function isRules<V>(v: V) {
  return is$typed(v, id, hashRules)
}

export function validateRules<V>(v: V) {
  return validate<Rules & V>(v, id, hashRules)
}

/** A player's standing on the ladder as derived by this appview. Never written to a repo: every indexer computes it from the public match, accept and move records with the algorithm named in `algorithm`. */
export interface PlayerRating {
  $type?: 'top.manalath.defs#playerRating'
  did: string
  /** Glicko-2 rating, rounded. */
  rating: number
  /** Glicko-2 rating deviation at the time of the query, rounded. */
  deviation: number
  /** Rated games folded into this rating. */
  games: number
  /** Display grade on a go-style ladder, e.g. `6k` or `2d`. Absent until the player has a rated game. */
  rank?: string
  /** True while the deviation is too wide to trust the rank. */
  provisional: boolean
  lastPlayedAt?: string
  /** Identifier of the rating algorithm and version, e.g. `glicko2-v1`. */
  algorithm: string
}

const hashPlayerRating = 'playerRating'

export function isPlayerRating<V>(v: V) {
  return is$typed(v, id, hashPlayerRating)
}

export function validatePlayerRating<V>(v: V) {
  return validate<PlayerRating & V>(v, id, hashPlayerRating)
}
