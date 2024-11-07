import { Store } from 'express-session';
import { PrismaClient } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { createId } from '@paralleldrive/cuid2';


export class CorePrismaSessionStore extends Store {
  private prisma: PrismaClient;

  constructor(prismaService: PrismaService) {
    super();
    this.prisma = prismaService.prismaClient;
  }

  public get = async (
      sid: string,
      callback: (err: any, session?: any | null) => void,
  ) => {
    try {
      const record = await this.prisma.session.findUnique({ where: { sid } });
      if (!record) {
        return callback(null, null);
      }
      if (record.expiresAt && record.expiresAt <= new Date()) {
        await this.prisma.session.delete({ where: { sid } });
        return callback(null, null);
      }
      const session = JSON.parse(record.data);
      return callback(null, session);
    } catch (err) {
      return callback(err);
    }
  };

  public set = async (
      sid: string,
      session: any,
      callback?: (err?: any) => void,
  ) => {
    try {
      let userId = null;
      if (session.passport && session.passport.user) {
        userId = session.passport.user;
      }
      const data = JSON.stringify(session);
      const expiresAt =
          session.cookie && session.cookie.expires
              ? new Date(session.cookie.expires)
              : null;

      await this.prisma.session.upsert({
        where: { sid },
        create: {
          id: createId(),
          sid,
          data,
          expiresAt,
          userId,
        },
        update: {
          data,
          expiresAt,
          userId,
        },
      });
      callback?.();
    } catch (err) {
      console.error('Error while setting session:', err);
      callback?.(err);
    }
  };

  public destroy = async (sid: string, callback?: (err?: any) => void) => {
    try {
      await this.prisma.session.delete({ where: { sid } });
      callback?.();
    } catch (err) {
      if (
          err instanceof PrismaClientKnownRequestError &&
          err.code === 'P2025'
      ) {
        callback?.();
      } else {
        callback?.(new Error('Failed to destroy session.'));
      }
    }
  };

  public touch = async (
      sid: string,
      session: any,
      callback?: (err?: any) => void,
  ) => {
    try {
      let expiresAt = null;
      if (session.cookie && session.cookie.maxAge) {
        expiresAt = new Date(Date.now() + session.cookie.maxAge);
      }
      await this.prisma.session.update({
        where: { sid },
        data: { expiresAt },
      });
      if (callback) callback();
    } catch (err) {
      if (callback) callback(err);
    }
  };
}
