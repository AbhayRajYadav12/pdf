import { createWorker, type Worker } from "tesseract.js";

export interface OcrEngine {
  recognize(image: Uint8Array): Promise<string>;
}

let workerPromise: Promise<Worker> | null = null;

export function createTesseractOcr(): OcrEngine {
  return {
    async recognize(image) {
      if (!workerPromise) workerPromise = createWorker("eng");
      const worker = await workerPromise;
      const result = await worker.recognize(Buffer.from(image));
      return result.data.text ?? "";
    },
  };
}

export function shouldOcr(text: string, minChars: number): boolean {
  return text.trim().length < minChars;
}
