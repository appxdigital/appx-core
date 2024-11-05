import { Injectable } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  constructor(private prisma: PrismaService) {
    super();
  }

  serializeUser(user: any, done: Function) {
    done(null, user.id);
  }

  async deserializeUser(userId: string, done: Function) {
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: Number(userId) },
        select: {
          id: true,
          role: true,
        },
      });
      done(null, user);
    } catch (error) {
      done(new Error('User not found'), null);
    }
  }
}
