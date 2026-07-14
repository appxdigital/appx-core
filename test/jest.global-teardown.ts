export default async function globalTeardown(): Promise<void> {
    const stop = (global as any).__APPX_DB_STOP as (() => Promise<void>) | undefined;
    if (stop) {
        try {
            await stop();
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[appx-core test] container stop failed:', e);
        }
    }
}
