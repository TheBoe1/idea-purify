import { randomUUID } from 'node:crypto'
import type { AuthRepository, EmailTokenPurpose, UserRecord } from '../backend/db/auth.ts'
import type { IdeaRepository } from '../backend/db/ideas.ts'
import type { Idea } from '../shared/contracts/idea.ts'

// Independent test doubles enforce ownership and one-time token semantics.
// They do not claim to verify the actual MySQL repository or SMTP delivery.
export function createSecurityRepositories() {
  const users = new Map<string, UserRecord>()
  const ideas = new Map<string, { owner: string; idea: Idea }>()
  const tokens = new Map<string, { userId: string; purpose: EmailTokenPurpose; expires: Date; used: boolean }>()
  const publicUser = (user: UserRecord) => {
    const { passwordHash: _passwordHash, authVersion: _authVersion, ...result } = user
    return result
  }
  const authRepository: AuthRepository = {
    async findById(id) { return users.get(id) ?? null },
    async findByUsername(username) { return [...users.values()].find(user => user.username === username) ?? null },
    async findByEmail(email) { return [...users.values()].find(user => user.email === email) ?? null },
    async create(input) {
      if ([...users.values()].some(user => user.username === input.username || (input.email && user.email === input.email))) {
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
      }
      const user: UserRecord = { userId: randomUUID(), username: input.username, email: input.email,
        passwordHash: input.passwordHash, role: input.role ?? 'user', emailVerified: false, disabled: false,
        createdTime: new Date().toISOString(), authVersion: 1 }
      users.set(user.userId, user)
      return user
    },
    async listUsers() { return [...users.values()].map(publicUser) },
    async setDisabled(id, disabled) {
      const user = users.get(id)
      if (!user) return null
      if (user.role === 'user') { user.disabled = disabled; user.authVersion++ }
      return publicUser(user)
    },
    async updateNickname(id, nickname) {
      const user = users.get(id)
      if (!user || user.disabled) return null
      user.nickname = nickname
      return publicUser(user)
    },
    async issueEmailToken(userId, purpose, hash, expires) {
      for (const [key, token] of tokens) if (token.userId === userId && token.purpose === purpose) tokens.delete(key)
      tokens.set(hash.toString('hex'), { userId, purpose, expires, used: false })
    },
    async consumeEmailToken(hash, purpose, passwordHash) {
      const token = tokens.get(hash.toString('hex'))
      const user = token && users.get(token.userId)
      if (!token || token.used || token.purpose !== purpose || token.expires <= new Date() || !user || user.disabled) return false
      if (purpose === 'reset-password') {
        if (!passwordHash) return false
        user.passwordHash = passwordHash
        user.authVersion++
      } else user.emailVerified = true
      token.used = true
      return true
    },
  }
  const ideaRepository: IdeaRepository = {
    async create(owner, input) {
      const idea = { ideaId: String(ideas.size + 1), ideaContent: input.ideaContent, createdTime: new Date().toISOString() }
      ideas.set(idea.ideaId, { owner, idea })
      return idea
    },
    async list(owner) { return [...ideas.values()].filter(record => record.owner === owner).map(record => record.idea) },
    async find(owner, id) {
      const record = ideas.get(id)
      return record?.owner === owner ? record.idea : null
    },
  }
  return { authRepository, ideaRepository, users, ideas, tokens }
}
