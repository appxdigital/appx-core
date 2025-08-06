
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../modules/auth/auth.service';

@Injectable()
export class UserPopulationGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();

        if (request.isAuthenticated && request.isAuthenticated()) {
            return true;
        }

        // If there is no session, we try to populate user from JWT
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7, authHeader.length);

            try {
                const payload = await this.jwtService.verifyAsync(token, {
                    secret: this.configService.get<string>('JWT_SECRET'),
                });

                request.user = await this.authService.validateJwtPayload(payload);
            } catch (error) {
                // If Token is invalid, expired, or something else went wrong.
                // We do nothing and the user remains unauthenticated (a GUEST).
            }
        }
        return true;
    }
}