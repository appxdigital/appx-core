import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS_CONFIG_TOKEN, PermissionsConfigType, PrismaService } from '@appxdigital/appx-core';
import { PermissionsConfig } from '../config/permissions.config';

@Global()
@Module({
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => {
        const prisma = new PrismaClient();
        prisma.$connect();
        return prisma;
      },
    },
    {
      provide: PERMISSIONS_CONFIG_TOKEN,
      useValue: PermissionsConfig,
    },
    {
      provide: PrismaService,
      useFactory: (prismaClient: PrismaClient, permissionsConfig: PermissionsConfigType) => {
        return new PrismaService(prismaClient, permissionsConfig);
      },
      inject: [PrismaClient, PERMISSIONS_CONFIG_TOKEN],
    },
  ],
  exports: [PrismaService, PERMISSIONS_CONFIG_TOKEN],
})
export class PrismaModule {}
