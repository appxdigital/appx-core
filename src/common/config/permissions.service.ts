import {Injectable, Inject} from '@nestjs/common';
import {PERMISSIONS_CONFIG_TOKEN} from './permissions.config.provider';
import {PermissionsConfigType} from './permissionsConfigTypes';

@Injectable()
export class PermissionsService {
    constructor(
        @Inject(PERMISSIONS_CONFIG_TOKEN)
        private readonly permissionsConfig: PermissionsConfigType,
    ) {}

    getPermissionsConfig(): PermissionsConfigType {
        return this.permissionsConfig;
    }
}
