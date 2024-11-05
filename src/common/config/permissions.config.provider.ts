import { DefaultPermissionsConfig } from './default-permissions.config';
import { PermissionsConfigType } from './permissionsConfigTypes';
export const PERMISSIONS_CONFIG_TOKEN = 'PERMISSIONS_CONFIG';

export const PermissionsConfigProvider = {
    provide: PERMISSIONS_CONFIG_TOKEN,
    useFactory: (config?: PermissionsConfigType): PermissionsConfigType => {
        return config || DefaultPermissionsConfig;
    },
    inject: ['CUSTOM_PERMISSIONS_CONFIG'],
};
