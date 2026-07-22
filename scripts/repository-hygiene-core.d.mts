export type RepositoryHygieneFinding = {
  path: string;
  code: string;
};

export const MAX_TRACKED_FILE_BYTES: number;

export function inspectTrackedFile(input: {
  path: string;
  size: number;
  content: string | null;
}): RepositoryHygieneFinding[];
