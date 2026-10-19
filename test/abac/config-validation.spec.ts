/**
 * Boot gate: PrismaService validates the permissions config against the schema
 * in its constructor. Errors reject boot; a valid Option A config constructs.
 */
import { buildAbacModule } from './helpers';

const $UID = '$USER_ID';

describe('permissions config boot validation', () => {
    test('rejects boot when a required-FK target has no connect rule', async () => {
        await expect(
            buildAbacModule({ Project: { USER: { create: 'ALL' } } } as any),
        ).rejects.toThrow(/Invalid permissions configuration[\s\S]*required foreign key 'ownerId'[\s\S]*User/i);
    });

    test('rejects boot when a create condition references a relation', async () => {
        await expect(
            buildAbacModule({
                Project: { USER: { create: { conditions: { owner: { id: $UID } } } } },
                User: { USER: { connect: 'ALL' } },
            } as any),
        ).rejects.toThrow(/Invalid permissions configuration[\s\S]*references relation 'owner'/i);
    });

    test('constructs with a valid Option A config', async () => {
        const built = await buildAbacModule({
            Project: { USER: { create: { conditions: { ownerId: $UID } } } },
            User: { USER: { connect: 'ALL' } },
        } as any);
        expect(built.prisma).toBeDefined();
        await built.close();
    });

    test('a relation-scoped connect lets a required FK boot without a destination rule', async () => {
        // Project.ownerId is required and User has NO connect rule — but the
        // source declares relations.owner.connect, which satisfies the requirement.
        const built = await buildAbacModule({
            Project: { USER: { create: 'ALL', relations: { owner: { connect: 'ALL' } } } },
        } as any);
        expect(built.prisma).toBeDefined();
        await built.close();
    });

    test('rejects boot when a fields rule names a column the model does not have', async () => {
        await expect(
            buildAbacModule({ User: { USER: { fields: { emial: { visibleOnlyWhen: { id: $UID } } } } } } as any),
        ).rejects.toThrow(/Invalid permissions configuration[\s\S]*fields\.emial does not name a column of User/i);
    });

    test('rejects boot when visibleOnlyWhen crosses a relation', async () => {
        await expect(
            buildAbacModule({ Project: { USER: { fields: { name: { visibleOnlyWhen: { owner: { id: $UID } } } } } } } as any),
        ).rejects.toThrow(/Invalid permissions configuration[\s\S]*references 'owner', which is not a column of Project/i);
    });

    test('constructs with an own-column fields rule; warns when @Role excludes the role', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            const built = await buildAbacModule({
                User: { USER: { fields: { email: { visibleOnlyWhen: { id: $UID } } } } },
                Project: { USER: { fields: { secretApiKey: { visibleOnlyWhen: { ownerId: $UID } } } } },
            } as any);
            expect(built.prisma).toBeDefined();
            await built.close();
            const messages = warn.mock.calls.map((c) => String(c[1]));
            expect(messages.filter((m) => m.includes('fields.'))).toEqual([
                expect.stringMatching(/Project\.USER\.fields\.secretApiKey has no effect/),
            ]);
        } finally {
            warn.mockRestore();
        }
    });
});

