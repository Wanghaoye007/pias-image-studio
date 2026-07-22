export type ReleaseMetadata = {
  schemaVersion: 1;
  service: 'content-studio';
  version: string;
  revision: string;
  dirty: boolean;
  builtAt: string;
};

export function writeReleaseMetadata(options: {
  packageFile: string;
  artifactDirectory: string;
  revision: string;
  dirty: boolean;
  builtAt: string;
}): Promise<ReleaseMetadata>;
