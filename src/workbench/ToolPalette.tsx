import {
  Blend,
  Crop,
  Eraser,
  Expand,
  ScanLine,
  Sparkles,
  SunMedium,
  View,
  type LucideIcon,
} from 'lucide-react';
import { taskProfiles, type TaskProfileId } from '../domain';

type ToolPaletteProps = {
  activeTool: TaskProfileId;
  onSelect: (tool: TaskProfileId) => void;
};

const toolIcons: Record<TaskProfileId, LucideIcon> = {
  generate: Sparkles,
  blend: Blend,
  angle: View,
  light: SunMedium,
  remove: Eraser,
  extract: ScanLine,
  expand: Expand,
  upscale: Crop,
};

export function ToolPalette({ activeTool, onSelect }: ToolPaletteProps) {
  return (
    <div className="tool-palette" aria-label="图片工具" role="toolbar">
      {taskProfiles.map((profile) => {
        const Icon = toolIcons[profile.id];
        return (
          <button
            aria-label={profile.label}
            aria-pressed={activeTool === profile.id}
            className={activeTool === profile.id ? 'is-active' : ''}
            key={profile.id}
            onClick={() => onSelect(profile.id)}
            title={profile.description}
            type="button"
          >
            <Icon size={17} />
          </button>
        );
      })}
    </div>
  );
}
