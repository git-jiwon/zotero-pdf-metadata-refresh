export async function runRecognitionPipeline<T>(steps: {
    native(): Promise<T | null>;
    urls(candidate: T | null): Promise<T | null>;
    settled(candidate: T | null): boolean;
    vision(): Promise<T | null>;
    visionUrls(candidate: T): Promise<T | null>;
    fallback(): Promise<T | null>;
    cancelled(): boolean;
    failed(stage: string, cause: unknown): void;
    textUsable?(): boolean;
}): Promise<T | null> {
    const run = async (stage: string, action: () => Promise<T | null>) => {
        if (steps.cancelled())
            return null;
        try {
            return await action();
        }
        catch (cause) {
            steps.failed(stage, cause);
            return null;
        }
    };
    const usable = steps.textUsable ? steps.textUsable() : true;
    const native = usable ? await run('Zotero', steps.native) : null;
    const searched = usable ? await run('URL 검색', () => steps.urls(native)) : null;
    if (steps.cancelled())
        return null;
    if (steps.settled(searched))
        return searched;
    const vision = await run('LM Studio 이미지', steps.vision);
    if (steps.cancelled())
        return null;
    if (vision) {
        const linked = await run('LM Studio 결과 URL 재검색', () => steps.visionUrls(vision));
        return steps.cancelled() ? null : linked || vision;
    }
    return searched || native || await run('문서 서지정보', steps.fallback);
}
