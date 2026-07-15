import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import type { Asset, Scene, StudioState } from '../domain';
import { getSceneTitle } from './graph';

type SceneRailProps = {
  state: StudioState;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectScene: (scene: Scene) => void;
};

type RailTab = 'scenes' | 'assets';

export function SceneRail({
  state,
  collapsed,
  onToggleCollapsed,
  onSelectScene,
}: SceneRailProps) {
  const [activeTab, setActiveTab] = useState<RailTab>('assets');
  const [query, setQuery] = useState('');
  const filteredAssets = useMemo(() => filterAssets(state.assets, query), [query, state.assets]);

  return (
    <aside className={`scene-rail ${collapsed ? 'is-collapsed' : ''}`} aria-label="场景与素材">
      <button
        aria-label={collapsed ? '展开场景与素材栏' : '收起场景与素材栏'}
        className="scene-rail__collapse"
        onClick={onToggleCollapsed}
        title={collapsed ? '展开场景与素材栏' : '收起场景与素材栏'}
        type="button"
      >
        {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
      </button>

      {!collapsed && (
        <div className="scene-rail__content">
          <div className="scene-rail__tabs" role="tablist" aria-label="场景与素材切换">
            <button
              aria-selected={activeTab === 'scenes'}
              onClick={() => setActiveTab('scenes')}
              role="tab"
              type="button"
            >
              场景
            </button>
            <button
              aria-selected={activeTab === 'assets'}
              onClick={() => setActiveTab('assets')}
              role="tab"
              type="button"
            >
              素材
            </button>
          </div>

          {activeTab === 'scenes' ? (
            <div className="scene-list" role="tabpanel" aria-label="场景列表">
              {state.scenes.map((scene) => {
                const sceneTitle = getSceneTitle(scene);

                return (
                  <button
                    aria-current={scene.id === state.selectedSceneId ? 'true' : undefined}
                    aria-label={`${sceneTitle}，${scene.skuCode}`}
                    className={scene.id === state.selectedSceneId ? 'is-active' : ''}
                    key={scene.id}
                    onClick={() => onSelectScene(scene)}
                    type="button"
                  >
                    <img src={scene.imageUrl} alt="" />
                    <span>{sceneTitle}</span>
                    <small>{scene.skuCode}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="asset-library" role="tabpanel" aria-label="素材库">
              <label className="asset-search">
                <span>搜索素材</span>
                <Search size={15} />
                <input
                  aria-label="搜索素材"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索 SKU 或用途"
                  type="search"
                  value={query}
                />
              </label>
              <AssetGroup assets={filteredAssets.filter((asset) => asset.id === 'asset-main')} label="商品素材" />
              <AssetGroup assets={filteredAssets.filter((asset) => asset.id === 'asset-scene')} label="上传素材" />
              <AssetGroup
                assets={filteredAssets.filter((asset) => !['asset-main', 'asset-scene'].includes(asset.id))}
                label="品牌素材"
              />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function AssetGroup({ assets, label }: { assets: Asset[]; label: string }) {
  return (
    <section className="asset-group" aria-label={label}>
      <h3>{label}</h3>
      <div className="asset-grid">
        {assets.map((asset) => (
          <button
            aria-label={`${asset.product}，${asset.skuCode}，${asset.usage}`}
            draggable
            key={asset.id}
            onDragStart={(event) => handleAssetDragStart(event, asset.id)}
            type="button"
          >
            <img src={asset.imageUrl} alt="" />
            <span>{asset.product}</span>
            <small>{asset.skuCode}</small>
          </button>
        ))}
        {assets.length === 0 && <p>暂无匹配素材</p>}
      </div>
    </section>
  );
}

function handleAssetDragStart(event: DragEvent<HTMLButtonElement>, assetId: string) {
  event.dataTransfer.setData('application/x-pias-asset', assetId);
  event.dataTransfer.effectAllowed = 'copy';
}

function filterAssets(assets: Asset[], query: string): Asset[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) return assets;

  return assets.filter((asset) =>
    [asset.brand, asset.product, asset.skuCode, asset.usage, asset.version]
      .some((value) => value.toLocaleLowerCase('zh-CN').includes(normalized)),
  );
}
