import argon2 from 'argon2'

// OWASP Argon2id 基线，盐由成熟库随机生成，保存完整算法/参数/盐/摘要。
export const hashPassword = (password: string) => argon2.hash(password, {
    type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32,
})
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password)
