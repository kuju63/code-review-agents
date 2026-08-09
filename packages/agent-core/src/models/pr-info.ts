import { z } from "zod";

export const RepositoryInfoSchema = z.object({
  owner: z.string(),
  repository: z.string(),
});
export type RepositoryInfo = z.infer<typeof RepositoryInfoSchema>;

export const FileChangeSchema = z.object({
  filePath: z.string(),
  patch: z.string().nullable().default(null),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

export const PRInfoSchema = z.object({
  title: z.string(),
  prNumber: z.number().int(),
  body: z.string().nullable().default(null),
  labels: z.array(z.string()).default([]),
  fileChanges: z.array(FileChangeSchema).default([]),
});
export type PRInfo = z.infer<typeof PRInfoSchema>;

export const PRInfoResultSchema = z.object({
  repositoryInfo: RepositoryInfoSchema,
  projectSummary: z.string(),
  prInfo: PRInfoSchema,
  dependencyFiles: z.array(z.string()).default([]),
  manifestContents: z.record(z.string(), z.string()).default({}),
});
export type PRInfoResult = z.infer<typeof PRInfoResultSchema>;
