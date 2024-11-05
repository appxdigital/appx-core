import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (!request.session) {
      throw new UnauthorizedException('Session not found');
    }
    if (!request.user) {
      throw new UnauthorizedException('User not authenticated');
    }
    if (
      request.session.expiresAt &&
      new Date() > new Date(request.session.expiresAt)
    ) {
      throw new ForbiddenException('Session has expired');
    }
    return true;
  }
}
