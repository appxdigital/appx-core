/**
 * Canonical seed dataset for the ABAC relation matrix (§1.0.3).
 *
 * Built via the RAW Prisma client (bypasses the proxy) and applied once in
 * beforeAll for the read-only matrix. Returns the created records so tests can
 * reference `.id`. User ids are pinned (1..4, 99) so `$USER_ID` conditions line
 * up with the impersonated actor.
 */

export interface SeededAbac {
    tenants: { T1: any; T2: any };
    users: { alice: any; bob: any; carol: any; dave: any; root: any };
    profiles: { alice: any; bob: any; dave: any };
    tags: { urgent: any; frontend: any; secret: any };
    projects: { p1: any; p2: any; p3: any; p4: any };
    tasks: { t1: any; t2: any; t3: any; t4: any; t5: any };
    comments: { c1: any; c2: any; c3: any; c4: any; c5: any };
}

export async function seedAbac(raw: any): Promise<SeededAbac> {
    const T1 = await raw.tenant.create({ data: { name: 'Acme' } });
    const T2 = await raw.tenant.create({ data: { name: 'Initech' } });

    // Pinned ids; managers created before their reports (self-relation FK).
    // `password` is set (and @Role(none)) so omission / BYPASS_OMISSION is testable.
    const alice = await raw.user.create({ data: { id: 1, email: 'alice@t.io', password: 'hash-alice', role: 'USER', tenantId: T1.id } });
    const bob = await raw.user.create({ data: { id: 2, email: 'bob@t.io', password: 'hash-bob', role: 'USER', tenantId: T1.id, managerId: alice.id } });
    const carol = await raw.user.create({ data: { id: 3, email: 'carol@t.io', password: 'hash-carol', role: 'USER', tenantId: T1.id, managerId: alice.id } });
    const dave = await raw.user.create({ data: { id: 4, email: 'dave@t.io', password: 'hash-dave', role: 'USER', tenantId: T2.id } });
    const root = await raw.user.create({ data: { id: 99, email: 'root@t.io', password: 'hash-root', role: 'ADMIN' } });

    // 1:1 profiles — carol intentionally has none.
    const pAlice = await raw.userProfile.create({ data: { userId: alice.id, bio: 'founder', billingInfo: 'card-A' } });
    const pBob = await raw.userProfile.create({ data: { userId: bob.id, bio: 'dev', billingInfo: 'card-B' } });
    const pDave = await raw.userProfile.create({ data: { userId: dave.id, bio: 'ceo', billingInfo: 'card-D' } });

    const urgent = await raw.tag.create({ data: { name: 'urgent' } });
    const frontend = await raw.tag.create({ data: { name: 'frontend' } });
    const secret = await raw.tag.create({ data: { name: 'secret' } });

    const p1 = await raw.project.create({
        data: { name: 'Alpha', ownerId: alice.id, status: 'active', secretApiKey: 'sk-A', tags: { connect: [{ id: urgent.id }, { id: frontend.id }] } },
    });
    const p2 = await raw.project.create({
        data: { name: 'Beta', ownerId: alice.id, status: 'active', secretApiKey: 'sk-B', tags: { connect: [{ id: frontend.id }] } },
    });
    const p3 = await raw.project.create({
        data: { name: 'Gamma', ownerId: bob.id, status: 'draft', secretApiKey: null },
    });
    const p4 = await raw.project.create({
        data: { name: 'Delta', ownerId: dave.id, status: 'active', secretApiKey: 'sk-D', tags: { connect: [{ id: urgent.id }, { id: secret.id }] } },
    });

    for (const m of [
        { projectId: p1.id, userId: alice.id, role: 'manager' },
        { projectId: p2.id, userId: alice.id, role: 'manager' },
        { projectId: p3.id, userId: alice.id, role: 'contributor' },
        { projectId: p1.id, userId: bob.id, role: 'contributor' },
        { projectId: p3.id, userId: bob.id, role: 'manager' },
        { projectId: p1.id, userId: carol.id, role: 'contributor' },
        { projectId: p4.id, userId: dave.id, role: 'manager' },
    ]) {
        await raw.projectMember.create({ data: m });
    }

    const t1 = await raw.task.create({ data: { title: 't1', projectId: p1.id, assigneeId: alice.id } });
    const t2 = await raw.task.create({ data: { title: 't2', projectId: p1.id, assigneeId: bob.id, reviewerId: alice.id } });
    const t3 = await raw.task.create({ data: { title: 't3', projectId: p1.id } }); // no assignee — optional belongsTo
    const t4 = await raw.task.create({ data: { title: 't4', projectId: p3.id, assigneeId: carol.id, reviewerId: bob.id } });
    const t5 = await raw.task.create({ data: { title: 't5', projectId: p4.id, assigneeId: dave.id } });

    // Threaded: c1 <- c2 <- c3 (created parents-first).
    const c1 = await raw.comment.create({ data: { body: 'c1', taskId: t1.id, authorId: alice.id } });
    const c2 = await raw.comment.create({ data: { body: 'c2', taskId: t1.id, authorId: bob.id, parentId: c1.id } });
    const c3 = await raw.comment.create({ data: { body: 'c3', taskId: t1.id, authorId: carol.id, parentId: c2.id } });
    const c4 = await raw.comment.create({ data: { body: 'c4', taskId: t4.id, authorId: carol.id } });
    const c5 = await raw.comment.create({ data: { body: 'c5', taskId: t5.id, authorId: dave.id } });

    return {
        tenants: { T1, T2 },
        users: { alice, bob, carol, dave, root },
        profiles: { alice: pAlice, bob: pBob, dave: pDave },
        tags: { urgent, frontend, secret },
        projects: { p1, p2, p3, p4 },
        tasks: { t1, t2, t3, t4, t5 },
        comments: { c1, c2, c3, c4, c5 },
    };
}

/**
 * Truncate every ABAC model, children before parents. Self-relations
 * (Comment.parent, User.manager) are cleared depth-first, so the RESTRICT FK
 * doesn't fire. Implicit M:N (Project↔Tag) join rows clear with their Project.
 */
export async function resetAbac(raw: any): Promise<void> {
    await raw.comment.deleteMany({ where: { parentId: { not: null } } });
    await raw.comment.deleteMany({});
    await raw.task.deleteMany({});
    await raw.projectMember.deleteMany({});
    await raw.project.deleteMany({});
    await raw.tag.deleteMany({});
    await raw.userProfile.deleteMany({});
    await raw.user.deleteMany({ where: { managerId: { not: null } } });
    await raw.user.deleteMany({});
    await raw.tenant.deleteMany({});
}
