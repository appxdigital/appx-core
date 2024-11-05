import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Inject
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { transformContext } from '../utils/context-transformer.util';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
      private reflector: Reflector,
      @Inject('ROLES_ENUM') private rolesEnum: { [key: string]: any }
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const roles: string[] = this.reflector.get<string[]>('roles', context.getHandler());
    if (!roles) {
      return true;
    }
    const { req } = transformContext(context);
    if (!req || !req.user) {
      this.logger.log('No user found in request');
      return false;
    }

    return roles.some(role => this.rolesEnum[role] === req.user.role);
  }
}
