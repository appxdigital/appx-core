import {
    ForbiddenException,
    HttpException,
    HttpStatus,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import {UserService} from '../user/user.service';
import {RegisterDto} from './dto/register.dto';
import * as argon2 from 'argon2';
import {PrismaService} from '../../prisma/prisma.service';
import {ConfigService} from '@nestjs/config';
import {Request, Response} from 'express';
import {JwtService} from "@nestjs/jwt";
import {User} from "../../common/interfaces/user.interface";
import {createId} from "@paralleldrive/cuid2";

@Injectable()
export class AuthService {
    private readonly sessionCookieName: string;

    constructor(
        private readonly userService: UserService,
        private prisma: PrismaService,
        private readonly jwtService: JwtService,
        private configService: ConfigService,
    ) {
        this.sessionCookieName = this.configService.get<string>('SESSION_COOKIE_NAME', 'defaultCookieName');
    }

    async register(registerDto: RegisterDto) {
        const existingUser = await this.userService.findByEmail(registerDto.email);
        if (existingUser) {
            throw new HttpException('Email already in use', HttpStatus.CONFLICT);
        }
        const newUserData = {...registerDto};
        newUserData.password = await argon2.hash(registerDto.password);

        try {
            const newUser = await this.userService.createUser(newUserData);
            const {password, ...userWithoutPassword} = newUser;
            return {
                message: 'Registration successful',
                user: userWithoutPassword,
            };
        } catch (error) {
            throw new HttpException(
                'There was an error while creating your account. Please try again later.',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    async login(req: Request): Promise<{message: string; user: any}> {
        return new Promise<{message: string; user: any}>((resolve, reject) => {
            if (req?.user) {
                req.login(req.user, (err) => {
                    if (err) {
                        return reject(
                            new HttpException('Login failed', HttpStatus.INTERNAL_SERVER_ERROR),
                        );
                    }
                    req.session.save((err) => {
                        if (err) {
                            console.error('Session save error:', err);
                            return reject(
                                new HttpException(
                                    'Failed to save session',
                                    HttpStatus.INTERNAL_SERVER_ERROR,
                                ),
                            );
                        }
                        resolve({
                            message: 'Login successful',
                            user: req.user,
                        });
                    });
                });
            }
        });
    }

    async logout(req: Request, res: Response): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!req.isAuthenticated()) {
                return reject(new Error('User is not authenticated.'));
            }
            req.session.destroy((err) => {
                if (err) {
                    return reject(new Error('Failed to destroy session.'));
                }
                res.clearCookie(this.sessionCookieName);
                resolve();
            });
        });
    }

    async validateUser(
        username: string,
        password: string,
        usernameField: string,
    ): Promise<any> {
        const user = await this.userService.findByField(usernameField, username);
        if (!user) {
            throw new UnauthorizedException(
                `No user found with this ${usernameField}`,
            );
        }

        const isPasswordValid = await argon2.verify(user.password, password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }
        const {password: _password, ...userData} = user;
        return userData;
    }

    async getActiveSessions(req: Request) {
        return this.prisma.session.findMany({
            where: {
                userId: req?.user?.id,
                expiresAt: {
                    gte: new Date(),
                },
            },
        });
    }

    async closeAllUserSessions(req: Request, res: Response) {
        try {
            await new Promise<void>((resolve, reject) => {
                req.session.destroy((err) => {
                    if (err) {
                        return reject(new Error('Failed to destroy current session.'));
                    }
                    res.clearCookie(this.sessionCookieName);
                    resolve();
                });
            });
            await this.prisma?.session.deleteMany({
                where: {
                    userId: req?.user?.id,
                },
            });
            res
                .status(200)
                .send({message: 'All your sessions were closed successfully.'});
        } catch (error) {
            console.error('Error closing sessions:', error);
            res.status(500).send({message: 'Failed to close sessions.'});
        }
    }

    async getSessionsByUserId(userId: number) {
        return this.prisma.session.findMany({
            where: {userId, expiresAt: {gte: new Date()}},
        });
    }

    async closeSpecificSession(sessionId: string) {
        const deleted = await this.prisma.session.delete({
            where: {id: sessionId},
        }).catch(() => null);
        return !!deleted;
    }

    async validateJwtPayload(payload: any): Promise<any> {
        const user = await this.userService.findByField("id", payload.sub);
        if (!user) {
            throw new UnauthorizedException('Invalid token');
        }
        return user;
    }

    private async generateTokens(user: Pick<User, 'id' | 'role'>): Promise<{access_token: string; refresh_token: string}> {
        const accessTokenPayload = {sub: user.id, role: user.role};
        const refreshTokenPayload = {
            sub: user.id,
            jti: createId(),
        };
        const accessToken = this.jwtService.sign(accessTokenPayload, {
            secret: this.configService.get<string>('JWT_SECRET'),
            expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '15m'),
        });

        const refreshTokenString = this.jwtService.sign(refreshTokenPayload, {
            secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
            expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
        });

        const refreshExpiresInMs = this.parseExpiry(this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'));
        const expiresAt = new Date(Date.now() + refreshExpiresInMs);

        await this.prisma.userRefreshToken.create({
            data: {
                token: refreshTokenString,
                userId: user.id,
                expiresAt: expiresAt,
            },
        });

        return {access_token: accessToken, refresh_token: refreshTokenString};
    }

    async refreshTokens(userFromRefreshTokenGuard: any): Promise<{access_token: string; refresh_token: string}> {
        const userId = userFromRefreshTokenGuard.id;
        const currentTokenId = userFromRefreshTokenGuard.refreshTokenId;
        const providedTokenString = userFromRefreshTokenGuard.currentRefreshToken;

        // Invalidate the used refresh token
        await this.prisma.userRefreshToken.update({
            where: {id: currentTokenId},
            data: {revokedAt: new Date()},
        });

        const user = await this.userService.findByField("id", userId);
        if (!user) {
            throw new ForbiddenException('Access Denied');
        }

        return this.generateTokens(user);
    }

    private parseExpiry(expiryString: string): number {
        const unit = expiryString.slice(-1);
        const value = parseInt(expiryString.slice(0, -1), 10);
        if (unit === 'd') return value * 24 * 60 * 60 * 1000;
        if (unit === 'h') return value * 60 * 60 * 1000;
        if (unit === 'm') return value * 60 * 1000;
        return value * 1000;
    }


    async loginJwt(userFromAuthGuard: any): Promise<{access_token: string; refresh_token: string; user: any}> {
        const user = await this.userService.findByField("id", userFromAuthGuard.id);
        if (!user) {
            throw new UnauthorizedException('User not found');
        }
        const {access_token, refresh_token} = await this.generateTokens(user);
        const {password, ...userResult} = user;
        return {access_token: access_token, refresh_token: refresh_token, user: userResult};
    }

    async revokeRefreshTokensForUser(userId: number): Promise<void> {
        await this.prisma.userRefreshToken.updateMany({
            where: {userId: userId, revokedAt: null},
            data: {revokedAt: new Date()},
        });
    }
}
