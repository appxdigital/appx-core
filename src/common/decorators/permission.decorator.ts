import { SetMetadata } from '@nestjs/common';

export const PERMISSION_METADATA_KEY = 'permission';

export const Permission = (action: string) =>
  SetMetadata(PERMISSION_METADATA_KEY, { action });
