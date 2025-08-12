import {Injectable} from '@nestjs/common';
import {PrismaService} from '../../prisma/prisma.service';
import {UserCreateInput} from '../../common/interfaces/user.interface';
// @ts-ignore
import {User} from '@prisma/client';

@Injectable()
export class UserService {
    constructor(private prisma: PrismaService) {}

    async createUser(createUserInput: UserCreateInput): Promise<User> {
        return this.prisma.user.create({
            data: createUserInput,
        });
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
        return this.prisma.user.findUnique({
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
