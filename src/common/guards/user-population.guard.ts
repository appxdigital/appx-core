
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../../modules/auth/auth.service';
import { transformContext } from '../utils/context-transformer.util';

@Injectable()
export class UserPopulationGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Resolve the request across transports (HTTP and GraphQL) so JWT/session
        // population also applies to GraphQL requests — otherwise a GraphQL query
        // would reach the ABAC proxy with no user and be treated as a GUEST.
        const { req: request } = transformContext(context);

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