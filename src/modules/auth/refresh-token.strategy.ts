import {Injectable, UnauthorizedException} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {ExtractJwt, Strategy} from 'passport-jwt';
import {ConfigService} from '@nestjs/config';
import {Request} from 'express';
import {PrismaService} from '../../prisma/prisma.service';

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
    constructor(
        private readonly configService: ConfigService,
        private readonly prisma: PrismaService,
    ) {
        const refreshSecret = configService.get<string>('JWT_REFRESH_SECRET');
        if (!refreshSecret) {
            throw new Error('JWT_REFRESH_SECRET is not defined in environment variables!');
        }

        super({
            jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
            secretOrKey: refreshSecret,
            passReqToCallback: true,
        })
    }

    async validate(req: Request, payload: any) {
        const refreshToken = req.body.refreshToken;
        if (!refreshToken) throw new UnauthorizedException('Refresh token not found');

        // Auth-flow lookup: the refresh request is unauthenticated (GUEST), so
        // this must bypass ABAC like every other auth lookup in this module.
        const user = await this.prisma.user.findFirst({
            where: {id: payload.sub},
            },
            {
                BYPASS_FILTERING: true,
        });
        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const tokenRecord = await this.prisma.userRefreshToken.findFirst({
            where: {token: refreshToken},
            },
            {
                BYPASS_FILTERING: true,
        });

        if (!tokenRecord) {
            throw new UnauthorizedException('Refresh token not found in store');
        }
        if (tokenRecord.revokedAt) {
            await this.prisma.userRefreshToken.updateMany({
                where: {userId: user.id, revokedAt: null},
                data: {revokedAt: new Date()},
                },
                {
                    BYPASS_FILTERING: true,
            });
            throw new UnauthorizedException('Refresh token revoked');
        }
        if (new Date() > tokenRecord.expiresAt) {
            throw new UnauthorizedException('Refresh token expired');
        }

        return {...user, refreshTokenId: tokenRecord.id, currentRefreshToken: refreshToken};
    }
}