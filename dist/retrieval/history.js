/**
 * The Supersession chain for a subject (and optional Predicate): every Fact, past
 * and present, in chronological order — the "show your work" view. The subject is
 * resolved by name (exact/fuzzy) so variants find the same Entity; an unknown
 * subject yields an empty chain. Each Fact carries both transaction-time stamps
 * (`learnedAt`/`retiredAt`) so the chain shows when each link was retired, not just
 * its valid interval.
 */
export async function history(deps, entity, predicate) {
    const resolved = await deps.resolver.resolve(entity);
    if (!resolved.entityId)
        return [];
    return deps.store.history(resolved.entityId, predicate);
}
//# sourceMappingURL=history.js.map