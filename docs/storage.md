# File Uploads & Object Storage

> **Deprecated and frozen.** File upload is kept so existing projects keep working; it is no longer part of new projects and receives no further changes. It needs the storage packages installed in your project: `npm i multer` plus `@aws-sdk/client-s3` (`aws`) or `@google-cloud/storage` (`gcp`).
>
> To change it, or if a future upgrade breaks it, move it into your project — see [Moving file upload into your project](#moving-file-upload-into-your-project).

Accept file uploads over HTTP and store them in Amazon S3, Google Cloud Storage, or the local filesystem. One setup command wires the module; each upload endpoint declares its own size limit, MIME allowlist, and role access.

---

## Setup

Run inside your project:

```bash
appx-core setup:fileupload
```

The wizard asks for the storage provider (`aws`, `gcp`, or `local`) and the first endpoint (path, max size in MB, file category and MIME types, single or multiple files, allowed roles). It then:

- appends the provider's credentials to `.env`,
- writes `src/config/file-upload.config.ts`,
- registers the config in `app.module.ts` — `AppxCoreModule.forRoot(PermissionsConfig, fileUploadConfig)`.

### Provider environment variables

| Provider | Variables |
|---|---|
| `aws` | `AWS_BUCKET_NAME`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — the key pair is optional; without it the AWS SDK's default credential chain applies |
| `gcp` | `GCP_BUCKET_NAME`, `GCP_PROJECT_ID`, `GCP_KEY_FILE_PATH` (service-account key file) |
| `local` | none — files are written to `./uploads/` in the project |

---

## Endpoints

Each entry in `fileUploadConfig.endpoints` is an upload route. `POST` a `multipart/form-data` request with the file(s) in the `file` field:

```bash
curl -X POST https://api.example.com/upload/avatar -F "file=@avatar.png"
```

```ts
import {FileUploadModuleOptions} from '@appxdigital/appx-core';

export const fileUploadConfig: FileUploadModuleOptions = {
    cloudProvider: 'aws',
    endpoints: [
        {
            endpoint: '/upload/avatar',
            aliases: [],
            maxSize: 5 * 1024 * 1024, // bytes
            allowedTypes: ['image/jpeg', 'image/png'],
            multiple: false,
            roles: ['USER', 'ADMIN'], // or ['ALL'] for unrestricted
        },
    ],
};
```

Per request, the module enforces:

- **Role** — the caller's role must be in `roles` (`403` otherwise, including unauthenticated callers). `['ALL']` skips the check.
- **Size** — files above `maxSize` (bytes) are rejected.
- **Type** — a MIME type outside `allowedTypes` returns `400`. `image/jpg` is treated as `image/jpeg`.
- **Count** — `multiple: false` accepts one file; `true` accepts several under the same `file` field.

To add another endpoint, add an entry to the `endpoints` array.

### Response

`{ "message": "File uploaded successfully", "data": … }`, where `data` holds the storage result per file:

- `aws` — `{ key, location, … }`. The object key is the original filename, so uploading the same name overwrites the object; `location` is the bucket URL.
- `gcp` — `{ fileUrl }`. Stored under the original filename (same overwrite behaviour).
- `local` — `{ filePath, originalName, size, mimeType }`. Names are timestamp-prefixed, so repeated uploads never overwrite.

---

## Uploading from your own code

Inject `FileUploadService` to store a file from a custom endpoint or business logic — it delegates to the configured provider:

```ts
import {FileUploadService} from '@appxdigital/appx-core';

constructor(private fileUpload: FileUploadService) {}

async importReport(file: Express.Multer.File) {
    const stored = await this.fileUpload.uploadFile(file);
    // stored: the provider result (see Response above)
}
```

---

## Moving file upload into your project

The TypeScript source is in [`docs/legacy/file-upload/`](./legacy/file-upload/). Your copy works the same and is yours to change.

1. Copy the folder to `src/file-upload/` in your project.
2. Install the packages for your provider: `npm i multer` plus `@aws-sdk/client-s3` (`aws`) or `@google-cloud/storage` (`gcp`); `npm i -D @types/multer`.
3. In `src/app.module.ts`, register the module yourself and stop passing the config to the framework:

```ts
import {FileUploadModule} from './file-upload';
import {fileUploadConfig} from './config/file-upload.config';

@Module({
    imports: [
        AppxCoreModule.forRoot(PermissionsConfig),
        FileUploadModule.register(fileUploadConfig),
        // …
    ],
})
```

4. Change every other import of `FileUploadModuleOptions`, `FileUploadService`, `FileUploadInterceptor` or `StorageService` from `'@appxdigital/appx-core'` to your `./file-upload` folder (relative path).

The endpoints, config file, environment variables and responses stay the same.
