/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type LexiconDoc,
  Lexicons,
  ValidationError,
  type ValidationResult,
} from '@atproto/lexicon'
import { type $Typed, is$typed, maybe$typed } from './util.js'

export const schemaDict = {
  ComAtprotoRepoStrongRef: {
    lexicon: 1,
    id: 'com.atproto.repo.strongRef',
    description: 'A URI with a content-hash fingerprint.',
    defs: {
      main: {
        type: 'object',
        required: ['uri', 'cid'],
        properties: {
          uri: {
            type: 'string',
            format: 'at-uri',
          },
          cid: {
            type: 'string',
            format: 'cid',
          },
        },
      },
    },
  },
  TopManalathAccept: {
    lexicon: 1,
    id: 'top.manalath.accept',
    defs: {
      main: {
        type: 'record',
        description:
          "Acceptance of an top.manalath.match. Written to the accepting player's repo. Referencing the match by CID pins the exact terms agreed to.",
        key: 'tid',
        record: {
          type: 'object',
          required: ['match', 'createdAt'],
          properties: {
            match: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  TopManalathDefs: {
    lexicon: 1,
    id: 'top.manalath.defs',
    defs: {
      timeControl: {
        type: 'object',
        description:
          'Fischer clock: each player starts with `base` seconds and gains `increment` seconds per move.',
        required: ['base', 'increment'],
        properties: {
          base: {
            type: 'integer',
            minimum: 0,
            description: 'Initial time per player in seconds.',
          },
          increment: {
            type: 'integer',
            minimum: 0,
            description:
              "Time added after each of a player's moves, in seconds.",
          },
        },
      },
      rules: {
        type: 'object',
        description:
          'Board and rule variant. Only the standard 61-cell board (radius 4) is defined so far.',
        properties: {
          boardRadius: {
            type: 'integer',
            minimum: 1,
            maximum: 8,
            default: 4,
          },
        },
      },
    },
  },
  TopManalathMatch: {
    lexicon: 1,
    id: 'top.manalath.match',
    defs: {
      main: {
        type: 'record',
        description:
          "A proposal to play a game of Manalath. Written to the challenger's repo. The match starts once the opponent writes an top.manalath.accept referencing this record. Moves form a tree; a match is a labelled path through it, starting at `root` (or at the empty board when `root` is absent).",
        key: 'tid',
        record: {
          type: 'object',
          required: ['firstMover', 'createdAt'],
          properties: {
            opponent: {
              type: 'string',
              format: 'did',
              description:
                'The player being challenged. Absent for an open challenge that anyone may accept.',
            },
            firstMover: {
              type: 'string',
              description:
                "Who plays the first ply after `root`. `random` is resolved from the accept record's CID: if the last byte of the CID is even the challenger moves first, otherwise the opponent.",
              knownValues: ['challenger', 'opponent', 'random'],
            },
            root: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description:
                'An existing top.manalath.move to continue from. Absent to start from the empty board.',
            },
            rules: {
              type: 'ref',
              ref: 'lex:top.manalath.defs#rules',
            },
            timeControl: {
              type: 'ref',
              ref: 'lex:top.manalath.defs#timeControl',
              description: 'Absent for an untimed (correspondence) game.',
            },
            rated: {
              type: 'boolean',
              default: false,
            },
            arbiter: {
              type: 'string',
              format: 'did',
              description:
                "A game server both players agree to have run this match live. Not evidence in itself: an indexer treats the match as arbitrated only if this DID's repo holds a verdict record referencing this match by CID. Absent for self-reported games.",
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  TopManalathMove: {
    lexicon: 1,
    id: 'top.manalath.move',
    defs: {
      main: {
        type: 'record',
        description:
          'One ply in a game of Manalath, written to the repo of the player who made it. Moves form a tree via `prev`; `ply` is the absolute depth in that tree.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['match', 'ply', 'action', 'createdAt'],
          properties: {
            match: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description: 'The match this move was played in.',
            },
            ply: {
              type: 'integer',
              minimum: 0,
              description:
                'Depth in the move tree. Equal to prev.ply + 1, or 0 when starting from the empty board.',
            },
            prev: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description:
                "The previous move. Absent only at ply 0. For the first move of a forked match this is the match's `root`, which lives in another match.",
            },
            action: {
              type: 'union',
              refs: [
                'lex:top.manalath.move#place',
                'lex:top.manalath.move#pass',
                'lex:top.manalath.move#resign',
                'lex:top.manalath.move#offerDraw',
                'lex:top.manalath.move#acceptDraw',
                'lex:top.manalath.move#timeout',
              ],
            },
            clock: {
              type: 'ref',
              ref: 'lex:top.manalath.move#clock',
              description:
                'Informational clock state after this move, as stamped by the game server. Not authoritative for other indexers.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
      place: {
        type: 'object',
        description:
          'Place a stone of either colour on an empty cell. Axial coordinates, pointy-top layout, origin at the centre cell.',
        required: ['q', 'r', 'color'],
        properties: {
          q: {
            type: 'integer',
            minimum: -8,
            maximum: 8,
          },
          r: {
            type: 'integer',
            minimum: -8,
            maximum: 8,
          },
          color: {
            type: 'integer',
            minimum: 1,
            maximum: 2,
          },
        },
      },
      pass: {
        type: 'object',
        description: 'Pass. Only legal when the player has no legal placement.',
        properties: {},
      },
      resign: {
        type: 'object',
        properties: {},
      },
      offerDraw: {
        type: 'object',
        description:
          'Offer a draw. Does not consume the turn: the offering player still moves at this ply in a subsequent record only if the offer is declined; indexers treat the offer as pending until the next action.',
        properties: {},
      },
      acceptDraw: {
        type: 'object',
        properties: {},
      },
      timeout: {
        type: 'object',
        description:
          'The player whose repo this is written to ran out of time. Written by the game server acting for that player.',
        properties: {},
      },
      clock: {
        type: 'object',
        required: ['remainingMs'],
        properties: {
          remainingMs: {
            type: 'integer',
            minimum: 0,
            description: "The mover's remaining time after this move.",
          },
        },
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>
export const schemas = Object.values(schemaDict) satisfies LexiconDoc[]
export const lexicons: Lexicons = new Lexicons(schemas)

export function validate<T extends { $type: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType: true,
): ValidationResult<T>
export function validate<T extends { $type?: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: false,
): ValidationResult<T>
export function validate(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: boolean,
): ValidationResult {
  return (requiredType ? is$typed : maybe$typed)(v, id, hash)
    ? lexicons.validate(`${id}#${hash}`, v)
    : {
        success: false,
        error: new ValidationError(
          `Must be an object with "${hash === 'main' ? id : `${id}#${hash}`}" $type property`,
        ),
      }
}

export const ids = {
  ComAtprotoRepoStrongRef: 'com.atproto.repo.strongRef',
  TopManalathAccept: 'top.manalath.accept',
  TopManalathDefs: 'top.manalath.defs',
  TopManalathMatch: 'top.manalath.match',
  TopManalathMove: 'top.manalath.move',
} as const
