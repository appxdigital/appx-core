export interface StorageService {
    uploadFile(file: Express.Multer.File): Promise<any>;
}
