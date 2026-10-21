export interface AdminConfigType {
    adminRoles: string[];
    resources: {
        name: string;
        options?: {
            navigation?: {
                name?: string | null;
                icon?: string;
            };
            [key: string]: any;
        };
    }[];
    rootPath: string;
    branding: {
        companyName?: string;
        withMadeWithLove?: boolean;
        logo?: string;
    };
    dashboard?: {
        component: string;
        handler?: (request: any, response: any) => Promise<{[key: string]: any}>;
    };
    componentLoader: any;
}