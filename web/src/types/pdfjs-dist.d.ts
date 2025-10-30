declare module "pdfjs-dist/build/pdf" {
  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
    cleanup(): Promise<void>;
    destroy(): void;
  }

  export interface PDFPageProxy {
    getTextContent(): Promise<PDFTextContent>;
  }

  export interface PDFTextContent {
    items: Array<{ str?: string }>;
  }

  export const GlobalWorkerOptions: {
    workerSrc?: string;
    workerPort?: Worker | null;
  };

  export function getDocument(
    src: any
  ): {
    promise: Promise<PDFDocumentProxy>;
  };
}
