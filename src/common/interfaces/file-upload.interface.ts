export interface EndpointConfig {
    endpoint: string;
    maxSize: number;
    allowedTypes: string[];
    multiple: boolean;
    roles: string[];
}

export interface FileUploadModuleOptions {
    endpoints: EndpointConfig[];
    cloudProvider: 'aws' | 'gcp' | 'local';
}
