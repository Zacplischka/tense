import type { ExtractionResult, Extractor } from "./types.js";
export declare class StubExtractor implements Extractor {
    extract(text: string): Promise<ExtractionResult>;
}
