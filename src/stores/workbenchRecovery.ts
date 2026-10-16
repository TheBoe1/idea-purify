// Only a current tab's memory: a 401 may unmount the editor before reauthentication.
// Callers capture the editor owner before that happens and provide an immutable snapshot.
const snapshots = new Map<string, unknown>()
type LeaveGuard = () => boolean | Promise<boolean>
const leaveGuards = new Map<string, LeaveGuard>()

export function saveWorkbenchRecovery<T>(ownerId: string, snapshot: T): void {
  if (ownerId) snapshots.set(ownerId, snapshot)
}

export function takeWorkbenchRecovery<T>(ownerId: string): T | undefined {
  if (!ownerId || !snapshots.has(ownerId)) return undefined
  const snapshot = snapshots.get(ownerId) as T
  snapshots.delete(ownerId)
  return snapshot
}

export function clearWorkbenchRecovery(ownerId?: string): void {
  if (ownerId === undefined) snapshots.clear()
  else snapshots.delete(ownerId)
}

export function registerWorkbenchLeaveGuard(ownerId: string, guard: LeaveGuard): () => void {
  if (!ownerId) return () => {}
  leaveGuards.set(ownerId, guard)
  return () => {
    // An old editor unmounting must not unregister the replacement editor's guard.
    if (leaveGuards.get(ownerId) === guard) leaveGuards.delete(ownerId)
  }
}

export async function confirmWorkbenchLeave(ownerId?: string): Promise<boolean> {
  const guard = ownerId ? leaveGuards.get(ownerId) : undefined
  return guard ? (await guard()) === true : true
}
