import {Injectable} from '@nestjs/common';
import {PrismaService} from '../../prisma/prisma.service';
import {UserCreateInput} from '../../common/interfaces/user.interface';
import {CoreService} from "../core/core.service";
// @ts-ignore
import {User} from '@prisma/client';

@Injectable()
export class UserService extends CoreService<User> {
    constructor(protected prisma: PrismaService) {
        super(prisma.model.user);
    }

    async createUser(createUserInput: UserCreateInput): Promise<User> {
        // Registration is an unauthenticated framework flow (role GUEST has no
        // create permission). Its input is already constrained by RegisterDto,
        // so bypass access filtering — otherwise the create default-deny would
        // reject sign-up.
        return this.prisma.user.create(
            {data: createUserInput},
            // @ts-ignore — options arg is accepted by the proxy delegate
            {BYPASS_FILTERING: true},
        );
    }

    async findByField(field: string, value: any): Promise<any> {
        const where = {
            [field]: value,
        }

        return this.prisma.user.findFirst({
            where,
        });
    }

    async findByEmail(email: string) {
        return this.prisma.user.findFirst({
            where: {email},
            select: {
                id: true,
                password: true,
                email: true,
                name: true,
                role: true,
            },
        });
    }
}
