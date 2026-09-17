/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../lexicons'
import { type $Typed, is$typed as _is$typed, type OmitKey } from '../../../util'
import type * as ComAtprotoRepoStrongRef from '../../com/atproto/repo/strongRef.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'top.manalath.move'

export interface Main {
  $type: 'top.manalath.move'
  match: ComAtprotoRepoStrongRef.Main
  /** Depth in the move tree. Equal to prev.ply + 1, or 0 when starting from the empty board. */
  ply: number
  prev?: ComAtprotoRepoStrongRef.Main
  action:
    | $Typed<Place>
    | $Typed<Pass>
    | $Typed<Resign>
    | $Typed<OfferDraw>
    | $Typed<AcceptDraw>
    | $Typed<Timeout>
    | { $type: string }
  clock?: Clock
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

/** Place a stone of either colour on an empty cell. Axial coordinates, pointy-top layout, origin at the centre cell. */
export interface Place {
  $type?: 'top.manalath.move#place'
  q: number
  r: number
  color: number
}

const hashPlace = 'place'

export function isPlace<V>(v: V) {
  return is$typed(v, id, hashPlace)
}

export function validatePlace<V>(v: V) {
  return validate<Place & V>(v, id, hashPlace)
}

/** Pass. Only legal when the player has no legal placement. */
export interface Pass {
  $type?: 'top.manalath.move#pass'
}

const hashPass = 'pass'

export function isPass<V>(v: V) {
  return is$typed(v, id, hashPass)
}

export function validatePass<V>(v: V) {
  return validate<Pass & V>(v, id, hashPass)
}

export interface Resign {
  $type?: 'top.manalath.move#resign'
}

const hashResign = 'resign'

export function isResign<V>(v: V) {
  return is$typed(v, id, hashResign)
}

export function validateResign<V>(v: V) {
  return validate<Resign & V>(v, id, hashResign)
}

/** Offer a draw. Does not consume the turn: the offering player still moves at this ply in a subsequent record only if the offer is declined; indexers treat the offer as pending until the next action. */
export interface OfferDraw {
  $type?: 'top.manalath.move#offerDraw'
}

const hashOfferDraw = 'offerDraw'

export function isOfferDraw<V>(v: V) {
  return is$typed(v, id, hashOfferDraw)
}

export function validateOfferDraw<V>(v: V) {
  return validate<OfferDraw & V>(v, id, hashOfferDraw)
}

export interface AcceptDraw {
  $type?: 'top.manalath.move#acceptDraw'
}

const hashAcceptDraw = 'acceptDraw'

export function isAcceptDraw<V>(v: V) {
  return is$typed(v, id, hashAcceptDraw)
}

export function validateAcceptDraw<V>(v: V) {
  return validate<AcceptDraw & V>(v, id, hashAcceptDraw)
}

/** The player whose repo this is written to ran out of time. Written by the game server acting for that player. */
export interface Timeout {
  $type?: 'top.manalath.move#timeout'
}

const hashTimeout = 'timeout'

export function isTimeout<V>(v: V) {
  return is$typed(v, id, hashTimeout)
}

export function validateTimeout<V>(v: V) {
  return validate<Timeout & V>(v, id, hashTimeout)
}

export interface Clock {
  $type?: 'top.manalath.move#clock'
  /** The mover's remaining time after this move. */
  remainingMs: number
}

const hashClock = 'clock'

export function isClock<V>(v: V) {
  return is$typed(v, id, hashClock)
}

export function validateClock<V>(v: V) {
  return validate<Clock & V>(v, id, hashClock)
}
