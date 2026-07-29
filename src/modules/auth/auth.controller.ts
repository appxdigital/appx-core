import {Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Param, Post, Req, Res, UseGuards,} from '@nestjs/common';
import {AuthService} from './auth.service';
import {RegisterDto} from './dto/register.dto';
import {LocalAuthGuard} from './local-auth.guard';
import {AuthenticatedGuard} from './authenticated.guard';
import {Request, Response} from 'express';
import {RefreshTokenGuard} from "./refresh-token.guard";


@Controller('auth')
export class AuthController {
    constructor(protected readonly authService: AuthService) {}

    @Post('register')
    async register(@Body() registerDto: RegisterDto) {
        return this.authService.register(registerDto);
    }

    @UseGuards(LocalAuthGuard)
    @Post('login')
    async login(@Req() req: Request, @Res() res: Response) {
        try {
            const result = await this.authService.login(req);
            res.status(200).send(result);
        } catch (error) {
            res.status(500).send({message: 'Login failed'});
        }
    }

    @UseGuards(AuthenticatedGuard)
    @Post('logout')
    async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
        try {
            await this.authService.logout(req, res);
            res.status(200).send({message: 'Logout successful'});
        } catch (error: any) {
            if (error.message === 'User is not authenticated.') {
                res.status(HttpStatus.BAD_REQUEST).send({
                    message: 'User is not logged in or session already destroyed.',
                });
            } else {
                throw new HttpException(
                    'Logout failed.',
                    HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }
        }
    }

    @UseGuards(AuthenticatedGuard)
    @Get('me')
    async me(@Req() req: Request) {
        return {
            user: await this.authService.getCurrentUser(req)
        }
    }

    @UseGuards(AuthenticatedGuard)
    @Get('sessions')
    async getActiveSessions(@Req() req: Request) {
        const sessions = await this.authService.getActiveSessions(req);
        return {sessions};
    }

    @UseGuards(AuthenticatedGuard)
    @Post('sessions/close-my-sessions')
    async closeAllSessions(@Req() req: Request, @Res() res: Response) {
        return this.authService.closeAllUserSessions(req, res);
    }

    @UseGuards(AuthenticatedGuard)
    @Get('sessions/:userId')
    async getAllSessions(@Param('userId') userId: string, @Req() req: Request) {
        // AuthenticatedGuard gates authentication explicitly; the role check
        // below is the authorization step. De-hardcoding 'ADMIN' into the
        // permissions system is deferred (see ROADMAP / ).
        if (req.user?.role !== 'ADMIN') {
            throw new ForbiddenException('Access denied.');
        }
        // Pass the raw param through; the service coerces it to the User PK's
        // actual type. `parseInt('3f2a…', 10)` was `3` — a silent wrong-user
        // lookup for uuid ids — while `parseInt('f3a2…')` was `NaN`.
        const sessions = await this.authService.getSessionsByUserId(userId);
        return {sessions};
    }

    @UseGuards(AuthenticatedGuard)
    @Post('sessions/:sessionId/close')
    async closeSpecificSession(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        // See getAllSessions: AuthenticatedGuard = authn, role check = authz.
        if (req.user?.role !== 'ADMIN') {
            throw new ForbiddenException('Access denied.');
        }
        const result = await this.authService.closeSpecificSession(sessionId);
        if (result) {
            res.status(HttpStatus.OK).send({message: 'Session closed successfully.'});
        } else {
            res.status(HttpStatus.NOT_FOUND).send({message: 'Session not found.'});
        }
    }

    @UseGuards(LocalAuthGuard)
    @Post('login/jwt')
    async loginJwt(@Req() req: Request) {
        return await this.authService.loginJwt(req.user);
    }

    @UseGuards(RefreshTokenGuard)
    @Post('refresh')
    async refreshTokens(@Req() req: Request) {
        const userFromGuard = req.user as any;
        return this.authService.refreshTokens(userFromGuard);
    }

    @UseGuards(LocalAuthGuard)
    @Post('logout/jwt')
    async logoutJwt(@Req() req: Request) {
        const userId = req.user?.id;
        if (!userId) {
            throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
        }
        await this.authService.revokeRefreshTokensForUser(userId);
        return {message: 'Logout successful'};
    }
}
