import { extractText, extractTextItems, getDocumentProxy, renderPageAsImage } from "unpdf";
import { AppError } from "@pdf-summary/shared";
import { shouldOcr, type OcrEngine } from "./ocr.js";

async function closePdf(pdf: { destroy?: () => Promise<void>; cleanup?: () => void } | null): Promise<void> {
  await pdf?.destroy?.();
  pdf?.cleanup?.();
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  ocrUsed: boolean;
  items: TextItem[];
}

export interface TextItem {
  str: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface ExtractedDocument {
  pageCount: number;
  pages: ExtractedPage[];
  ocrPageCount: number;
}

export async function readPageCount(data: Uint8Array): Promise<number> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(data);
    return pdf.numPages;
  } catch {
    throw new AppError("INVALID_PDF", "The file is not a readable PDF", 400);
  } finally {
    await closePdf(pdf);
  }
}

export async function extractPdf(
  data: Uint8Array,
  options: {
    minChars: number;
    ocr: OcrEngine;
    renderPage?: (data: Uint8Array, pageNumber: number) => Promise<Uint8Array>;
  },
): Promise<ExtractedDocument> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(data);
    const textResult = await extractText(pdf, { mergePages: false });
    const positioned = await extractTextItems(pdf);
    const pageTexts = Array.isArray(textResult.text) ? textResult.text : [textResult.text];
    const pages: ExtractedPage[] = [];
    for (let index = 0; index < textResult.totalPages; index += 1) {
      const pageNumber = index + 1;
      let text = pageTexts[index] ?? "";
      let ocrUsed = false;
      const items = (positioned.items[index] ?? []).map((item) => ({
        str: item.str,
        x: item.x,
        y: item.y,
        fontSize: item.fontSize,
      }));
      if (shouldOcr(text, options.minChars)) {
        try {
          const image = options.renderPage
            ? await options.renderPage(data, pageNumber)
            : new Uint8Array(await renderPageAsImage(pdf, pageNumber, {
                canvasImport: () => import("@napi-rs/canvas"),
                scale: 2,
              }));
          const ocrText = (await options.ocr.recognize(image)).trim();
          if (ocrText) {
            text = ocrText;
            ocrUsed = true;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "OCR failed";
          if (text.trim().length === 0) {
            text = "";
          }
          pages.push({ pageNumber, text, ocrUsed: false, items });
          if (/canvas|tesseract/i.test(message) && index === textResult.totalPages - 1 && pages.every((page) => page.text.trim().length === 0)) {
            throw new AppError("OCR", "This scanned PDF could not be read. OCR rendering or the OCR engine failed.", 422);
          }
          continue;
        }
      }
      pages.push({ pageNumber, text, ocrUsed, items });
    }
    const ocrPageCount = pages.filter((page) => page.ocrUsed).length;
    if (pages.every((page) => page.text.trim().length === 0)) {
      throw new AppError("EMPTY_DOCUMENT", "No text could be extracted or recognized from this PDF", 422);
    }
    return { pageCount: textResult.totalPages, pages, ocrPageCount };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_PDF", "The PDF could not be parsed", 422);
  } finally {
    await closePdf(pdf);
  }
}
