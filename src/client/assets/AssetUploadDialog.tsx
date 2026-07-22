import { ImagePlus, Upload, X } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { Asset } from '../../shared/domain';
import { uploadAssetImage } from './assetImageClient';

const acceptedAssetImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxAssetImageBytes = 10 * 1024 * 1024;

type AssetUploadDialogProps = {
  onClose: () => void;
  onSubmit: (input: Omit<Asset, 'id'>) => void;
  submitLabel?: string;
};

export function AssetUploadDialog({
  onClose,
  onSubmit,
  submitLabel = '确认上传',
}: AssetUploadDialogProps) {
  const [brand, setBrand] = useState('Content Studio');
  const [product, setProduct] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [usage, setUsage] = useState('商品主图');
  const [version, setVersion] = useState('v1');
  const [imageUrl, setImageUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError('');
    setImageUrl('');
    setSelectedFile(null);
    setFileName('');
    if (!file) return;
    try {
      const nextImageUrl = await readAssetImage(file);
      setImageUrl(nextImageUrl);
      setSelectedFile(file);
      setFileName(file.name);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '图片读取失败');
      event.target.value = '';
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!selectedFile) return;
    setUploading(true);
    try {
      const uploaded = await uploadAssetImage(selectedFile);
      onSubmit({ brand, product, skuCode, usage, version, imageUrl: uploaded.imageUrl });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '素材上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="asset-upload-backdrop" onMouseDown={onClose}>
      <form
        aria-labelledby="asset-upload-title"
        aria-modal="true"
        className="asset-upload-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { void handleSubmit(event); }}
        role="dialog"
      >
        <header>
          <div>
            <h2 id="asset-upload-title">上传素材</h2>
            <p>图片会安全保存到当前项目，并保留素材版本与任务来源。</p>
          </div>
          <button aria-label="关闭上传素材" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="asset-upload-dialog__body">
          <label className="asset-upload-dropzone">
            <input
              accept="image/jpeg,image/png,image/webp"
              aria-label="素材图片"
              onChange={(event) => { void handleFileChange(event); }}
              type="file"
            />
            {imageUrl ? (
              <>
                <img alt="素材预览" src={imageUrl} />
                <span>{fileName}</span>
              </>
            ) : (
              <>
                <ImagePlus aria-hidden="true" size={28} />
                <strong>选择商品图片</strong>
                <span>PNG、JPG 或 WebP，最大 10 MB</span>
              </>
            )}
          </label>
          <div className="asset-upload-fields">
            <label>
              <span>品牌</span>
              <input aria-label="品牌" onChange={(event) => setBrand(event.target.value)} value={brand} />
            </label>
            <label>
              <span>商品名称</span>
              <input aria-label="商品名称" onChange={(event) => setProduct(event.target.value)} value={product} />
            </label>
            <label>
              <span>SKU 编码</span>
              <input aria-label="SKU 编码" onChange={(event) => setSkuCode(event.target.value)} value={skuCode} />
            </label>
            <label>
              <span>用途</span>
              <select aria-label="用途" onChange={(event) => setUsage(event.target.value)} value={usage}>
                <option>商品主图</option>
                <option>商品辅图</option>
                <option>场景参考</option>
                <option>模特参考</option>
              </select>
            </label>
            <label>
              <span>版本</span>
              <input aria-label="版本" onChange={(event) => setVersion(event.target.value)} value={version} />
            </label>
          </div>
        </div>
        {error && <p className="asset-upload-error" role="alert">{error}</p>}
        <footer>
          <button onClick={onClose} type="button">取消</button>
          <button
            className="is-primary"
            disabled={uploading || !brand.trim() || !product.trim() || !skuCode.trim() || !selectedFile || !imageUrl}
            type="submit"
          >
            <Upload aria-hidden="true" size={16} />
            {uploading ? '上传中' : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function readAssetImage(file: File): Promise<string> {
  if (!acceptedAssetImageTypes.has(file.type)) {
    return Promise.reject(new Error('仅支持 PNG、JPG 或 WebP 图片'));
  }
  if (file.size > maxAssetImageBytes) {
    return Promise.reject(new Error('图片不能超过 10 MB'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('图片读取失败，请重新选择'));
    reader.readAsDataURL(file);
  });
}
