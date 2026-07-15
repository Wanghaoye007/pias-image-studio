import {
  buildExportFilename,
  buildResultManifest,
  type ExportFormat,
  type ExportSize,
  type ExportSpec,
  type Result,
  type ResultManifestEntry,
  type StudioState,
} from './domain';

export type TextDeliveryArtifact = {
  filename: string;
  content: string;
  mimeType: string;
};

const manifestColumns: Array<keyof ResultManifestEntry> = [
  'resultId',
  'skuCode',
  'dimensions',
  'operation',
  'generatedAt',
  'reviewStatus',
];

export function resolveOutputDimensions(
  width: number,
  height: number,
  size: ExportSize,
): { width: number; height: number } {
  if (size === 'original') return { width, height };
  const maxEdge = Number(size);
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function serializeManifestCsv(entries: ResultManifestEntry[]): string {
  const rows = [manifestColumns.join(',')];
  entries.forEach((entry) => {
    rows.push(manifestColumns.map((column) => escapeCsv(String(entry[column]))).join(','));
  });
  return `${rows.join('\n')}\n`;
}

export function buildManifestArtifacts(
  state: StudioState,
  result: Result,
  spec: ExportSpec,
  imageFilename: string,
): TextDeliveryArtifact[] {
  const manifest = buildResultManifest(state, [result.id]);
  const stem = imageFilename.replace(/\.[^.]+$/, '');
  const artifacts: TextDeliveryArtifact[] = [];

  if (spec.includeManifestCsv) {
    artifacts.push({
      filename: `${stem}_manifest.csv`,
      content: serializeManifestCsv(manifest),
      mimeType: 'text/csv;charset=utf-8',
    });
  }
  if (spec.includeManifestJson) {
    artifacts.push({
      filename: `${stem}_manifest.json`,
      content: `${JSON.stringify({ exportSpec: spec, results: manifest }, null, 2)}\n`,
      mimeType: 'application/json;charset=utf-8',
    });
  }
  return artifacts;
}

export async function downloadProductionDelivery(
  state: StudioState,
  result: Result,
  spec: ExportSpec,
): Promise<string[]> {
  if (result.reviewStatus !== 'approved') {
    throw new Error('仅审核通过结果可生成生产导出');
  }

  const imageFilename = buildExportFilename(state, result.id, spec);
  const imageBlob = await renderImage(result.imageUrl, spec.format, spec.size);
  const artifacts = buildManifestArtifacts(state, result, spec, imageFilename);
  const files = [
    { filename: imageFilename, blob: imageBlob },
    ...artifacts.map((artifact) => ({
      filename: artifact.filename,
      blob: new Blob([artifact.content], { type: artifact.mimeType }),
    })),
  ];

  files.forEach(({ filename, blob }) => triggerDownload(filename, blob));
  return files.map(({ filename }) => filename);
}

export async function downloadWatermarkedPreview(result: Result): Promise<string> {
  const filename = `${sanitizePreviewName(result.title)}-预览.png`;
  const blob = await renderImage(result.imageUrl, 'png', 'original', true);
  triggerDownload(filename, blob);
  return filename;
}

async function renderImage(
  imageUrl: string,
  format: ExportFormat,
  size: ExportSize,
  watermarked = false,
): Promise<Blob> {
  const image = await loadImage(imageUrl);
  const output = resolveOutputDimensions(image.naturalWidth, image.naturalHeight, size);
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建图片导出画布');

  if (format === 'jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (watermarked) drawPreviewWatermark(context, canvas.width, canvas.height);

  const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  return canvasToBlob(canvas, mimeType, format === 'png' ? undefined : 0.92);
}

function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('结果图片加载失败，无法创建交付文件'));
    image.src = imageUrl;
  });
}

function drawPreviewWatermark(context: CanvasRenderingContext2D, width: number, height: number) {
  const fontSize = Math.max(18, Math.round(Math.min(width, height) / 13));
  const stepX = fontSize * 5.2;
  const stepY = fontSize * 3.2;
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(-Math.PI / 6);
  context.translate(-width / 2, -height / 2);
  context.font = `600 ${fontSize}px sans-serif`;
  context.fillStyle = 'rgba(255,255,255,.42)';
  context.textAlign = 'center';
  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      context.fillText('DRAFT / 预览用途', x, y);
    }
  }
  context.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片编码失败，请更换格式后重试'));
    }, mimeType, quality);
  });
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = url;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function sanitizePreviewName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|%]+/g, '-').replace(/\s+/g, '-') || '结果';
}
