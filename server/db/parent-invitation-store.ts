import { type Database, transaction } from './database.ts'
import { CONFIG } from '../fixed-config.ts'

// A young account has two parents at most: the one who made it, and another adult it invites by its @identifier.
export const MAX_PARENTS = CONFIG.children.parents

// An invitation to be a young one's parent, as its invited adult sees it.
export interface ParentInvitation {
  childId: number
  childName: string
  childHandle: string | null
  // The parent who sent it.
  from: string
  createdAt: number
}

interface InvitationRow {
  child_id: number
  child_name: string
  child_handle: string | null
  from_name: string
  created_at: number
}

// « Inviter un parent », its answer, and « Ne plus être parent ». Who may ask is the routes' to check.
export class ParentInvitationStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  parentsOf(childId: number): number[] {
    return (
      this.#db.prepare('SELECT parent_id AS id FROM account_parents WHERE child_id = ?').all(childId) as {
        id: number
      }[]
    ).map(row => row.id)
  }

  // A new one takes the place of the one sent before.
  invite(childId: number, fromId: number, toId: number, now: number) {
    this.#db
      .prepare('INSERT OR REPLACE INTO parent_invitations (child_id, from_id, to_id, created_at) VALUES (?, ?, ?, ?)')
      .run(childId, fromId, toId, now)
  }

  cancel(childId: number) {
    this.#db.prepare('DELETE FROM parent_invitations WHERE child_id = ?').run(childId)
  }

  // The invitations the adult has to answer, the oldest first.
  to(toId: number): ParentInvitation[] {
    const rows = this.#db
      .prepare(
        `SELECT i.child_id, cp.name AS child_name, cu.handle AS child_handle, fp.name AS from_name, i.created_at
        FROM parent_invitations i
        JOIN profiles cp ON cp.user_id = i.child_id
        JOIN users cu ON cu.id = i.child_id
        JOIN profiles fp ON fp.user_id = i.from_id
        WHERE i.to_id = ? ORDER BY i.created_at`
      )
      .all(toId) as unknown as InvitationRow[]
    return rows.map(row => ({
      childId: row.child_id,
      childName: row.child_name,
      childHandle: row.child_handle,
      from: row.from_name,
      createdAt: row.created_at
    }))
  }

  // « Accepter »: the adult becomes a parent, unless the young one has two already.
  accept(toId: number, childId: number, now: number): 'accepted' | 'none' | 'full' {
    return transaction(this.#db, () => {
      const asked = this.#db
        .prepare('SELECT 1 FROM parent_invitations WHERE child_id = ? AND to_id = ?')
        .get(childId, toId)
      if (!asked) return 'none'
      this.cancel(childId)
      if (this.parentsOf(childId).length >= MAX_PARENTS) return 'full'
      this.#db
        .prepare('INSERT OR IGNORE INTO account_parents (child_id, parent_id, created_at) VALUES (?, ?, ?)')
        .run(childId, toId, now)
      return 'accepted'
    })
  }

  // « Refuser »: nothing changes, and the parent who asked sees it is no longer waiting.
  refuse(toId: number, childId: number): boolean {
    return (
      this.#db.prepare('DELETE FROM parent_invitations WHERE child_id = ? AND to_id = ?').run(childId, toId).changes > 0
    )
  }

  // « Ne plus être parent »: never the last one, who deletes the account instead.
  leave(parentId: number, childId: number): boolean {
    return transaction(this.#db, () => {
      if (this.parentsOf(childId).length < MAX_PARENTS) return false
      this.#db.prepare('DELETE FROM account_parents WHERE child_id = ? AND parent_id = ?').run(childId, parentId)
      this.#db.prepare('DELETE FROM parent_invitations WHERE child_id = ? AND from_id = ?').run(childId, parentId)
      return true
    })
  }

  // The young accounts the account is the only parent of: they go with it.
  onlyChildrenOf(parentId: number): number[] {
    return (
      this.#db
        .prepare(
          `SELECT child_id AS id FROM account_parents WHERE parent_id = ?
          AND child_id NOT IN (SELECT child_id FROM account_parents WHERE parent_id != ?)`
        )
        .all(parentId, parentId) as { id: number }[]
    ).map(row => row.id)
  }
}
