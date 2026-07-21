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
});
