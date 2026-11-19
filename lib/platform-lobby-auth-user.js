/**
 * @param {'student'|'teacher'} kind
 * @param {{ id: number, username: string, displayName: string, avatarUrl?: string, banned?: boolean, lobbyRole?: string }} user
 */
export function buildLobbyAuthUser(kind, user) {
    const lobbyRole = String(user.lobbyRole || (kind === 'teacher' ? 'admin' : 'user'));
    const role = lobbyRole === 'admin' ? 'admin' : 'member';
    return {
        userId: `${kind}-${user.id}`,
        kind,
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: String(user.avatarUrl || ''),
        role,
        banned: Boolean(user.banned),
        lobbyRole,
    };
}