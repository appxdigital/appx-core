// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
/// <reference types="multer" />
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
export interface StorageService {
    uploadFile(file: Express.Multer.File): Promise<any>;
}
