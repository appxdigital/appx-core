// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
export interface EndpointConfig {
    endpoint: string;
    aliases: string[];
    maxSize: number;
    allowedTypes: string[];
    multiple: boolean;
    roles: string[];
}
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
export interface FileUploadModuleOptions {
    endpoints: EndpointConfig[];
    cloudProvider: 'aws' | 'gcp' | 'local';
}
