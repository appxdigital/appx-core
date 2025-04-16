import {Injectable} from '@nestjs/common';
import {Cron} from '@nestjs/schedule';
import {PrismaService} from '../prisma/prisma.service';

@Injectable()
export class SessionCleanupService {
    constructor(private prisma: PrismaService) {}

    @Cron('0 * * * *')
    async cleanUpExpiredSessions() {
        await this.prisma.session.deleteMany({
            where: {
                expiresAt: {lte: new Date()},
            },
        });
    }
}
