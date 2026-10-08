/**
 * Importing Documents from files (spec 27): the shapes of the preview and the
 * job as the app uses them, and the request bodies. The backend decides what
 * an import does; nothing here re-derives its rules.
 */

/** The file types the picker offers: JSON of spec 23, or Markdown. */
export const IMPORT_ACCEPT = '.json,.md,.markdown,.txt';

/** How often the job is read while it is queued or running. */
export const IMPORT_POLL_INTERVAL_MS = 2000;

/** What the importer chose for a Document that already exists in the Room (spec 27 Decision 5). */
export type ImportResolution = 'copy' | 'replace';

/** Something the import leaves out or changes in a Document, worded by the client. */
export type ImportWarningCode =
  | 'comments_dropped'
  | 'files_dropped'
  | 'player_dropped'
  | 'selective_to_private'
  | 'tags_not_created';

/** A warning of a Document: `count` or `names` as its code uses them. */
export interface ImportWarning {
  code: ImportWarningCode;
  count: number;
  names: string[];
}

/** A Document found in the uploaded files. */
export interface ImportPreviewDocument {
  /** Names it in the import request: the file's place and the Document's in it. */
  key: string;
  fileName: string;
  name: string;
  notesCount: number;
  imagesCount: number;
  tagNames: string[];
  /** The Document of the Room the file's id points at, when the importer sees it. */
  existingDocumentId: string | null;
  /** Whether Replace is offered: the importer manages that Document. */
  canReplace: boolean;
  warnings: ImportWarning[];
}

/** A Tag the import would create. */
export interface ImportTagToCreate {
  name: string;
  category: string | null;
}

/** What importing the files would do, nothing written yet. */
export interface ImportPreview {
  documents: ImportPreviewDocument[];
  matchedTags: string[];
  tagsToCreate: ImportTagToCreate[];
  unavailableTags: string[];
}

/** Why an image was skipped (`SkippedResponse.reason`). */
export type ImportSkipReason =
  | 'unreachable'
  | 'not_an_image'
  | 'too_large'
  | 'limit'
  | 'storage'
  | 'failed';

/** An image the import skipped. */
export interface ImportSkipped {
  documentId: string;
  documentName: string;
  /** The link without its query string. */
  url: string;
  reason: ImportSkipReason;
}

/** A Document the import created or replaced. */
export interface ImportedDocument {
  id: string;
  name: string;
}

/** What a finished import did. */
export interface ImportResult {
  created: ImportedDocument[];
  replaced: ImportedDocument[];
  skipped: ImportSkipped[];
}

/** Where an import job is. */
export type ImportJobStatus = 'queued' | 'running' | 'done' | 'failed';

/** An import job as the app uses it. */
export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  createdAt: string;
  finishedAt: string | null;
  result: ImportResult | null;
}

interface RawImportWarning {
  code: ImportWarningCode;
  count: number;
  names: string[];
}

/** A previewed Document as the API sends it (`PreviewDocumentResponse`). */
export interface RawImportPreviewDocument {
  key: string;
  file_name: string;
  name: string;
  notes_count: number;
  images_count: number;
  tag_names: string[];
  existing_document_id: string | null;
  can_replace: boolean;
  warnings: RawImportWarning[];
}

/** The preview as the API sends it (`ImportPreviewResponse`): converted in `toImportPreview` only. */
export interface RawImportPreview {
  documents: RawImportPreviewDocument[];
  matched_tags: string[];
  tags_to_create: { name: string; category: string | null }[];
  unavailable_tags: string[];
}

/** A job as the API sends it (`ImportJobResponse`): converted in `toImportJob` only. */
export interface RawImportJob {
  id: string;
  status: ImportJobStatus;
  created_at: string;
  finished_at: string | null;
  result: {
    created: ImportedDocument[];
    replaced: ImportedDocument[];
    skipped: {
      document_id: string;
      document_name: string;
      url: string;
      reason: ImportSkipReason;
    }[];
  } | null;
}

/** Maps the API's preview to the app's. */
export function toImportPreview(raw: RawImportPreview): ImportPreview {
  return {
    documents: raw.documents.map((document) => ({
      key: document.key,
      fileName: document.file_name,
      name: document.name,
      notesCount: document.notes_count,
      imagesCount: document.images_count,
      tagNames: document.tag_names,
      existingDocumentId: document.existing_document_id,
      canReplace: document.can_replace,
      warnings: document.warnings,
    })),
    matchedTags: raw.matched_tags,
    tagsToCreate: raw.tags_to_create,
    unavailableTags: raw.unavailable_tags,
  };
}

/** Maps the API's job to the app's. */
export function toImportJob(raw: RawImportJob): ImportJob {
  return {
    id: raw.id,
    status: raw.status,
    createdAt: raw.created_at,
    finishedAt: raw.finished_at,
    result:
      raw.result === null
        ? null
        : {
            created: raw.result.created,
            replaced: raw.result.replaced,
            skipped: raw.result.skipped.map((item) => ({
              documentId: item.document_id,
              documentName: item.document_name,
              url: item.url,
              reason: item.reason,
            })),
          },
  };
}

/** The upload of the preview: the same files the import will send again. */
export function previewFormData(files: File[]): FormData {
  const body = new FormData();
  files.forEach((file) => body.append('files', file));
  return body;
}

/**
 * The upload of the import: the files again and the choices, as a JSON field —
 * the Documents to import (`selected`) and, among them, the ones to replace
 * (`replace`).
 */
export function importFormData(files: File[], selected: string[], replace: string[]): FormData {
  const body = previewFormData(files);
  body.append('choices', JSON.stringify({ selected, replace }));
  return body;
}

/** Whether the job is still going: queued or running. */
export function isActiveImportJob(job: ImportJob | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}
