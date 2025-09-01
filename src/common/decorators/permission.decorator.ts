import {SetMetadata} from '@nestjs/common';

export const PERMISSION_METADATA_KEY = 'permission';

export const Permission = (action: string, expose_models: string[] = []) =>
    SetMetadata(PERMISSION_METADATA_KEY, {action, expose_models});
