import {
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

@Injectable()
export class AuthService {
    private readonly sessionCookieName: string;

    constructor(
        private readonly userService: UserService,
        private prisma: PrismaService,
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
            console.error(error);
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
                        console.error('Login error:', err);
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
                    console.error('Failed to destroy session: ', err);
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
        const user = await this.prisma.user.findFirst({
            where: {
                [usernameField]: username,
            }
        }, {
            BYPASS_OMISSION: true,
            BYPASS_FILTERING: true
        });
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

    async getCurrentUser(req: Request) {
        if (!req?.user?.id) {
            throw new UnauthorizedException('Please log-in');
        }
        return this.prisma.user.findUnique({
            where: {
                id: req?.user?.id,
            },
        });
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
                        console.error('Failed to destroy current session:', err);
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
}
