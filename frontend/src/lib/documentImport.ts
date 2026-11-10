import type { SectionKind } from "../types/landing";

/**
 * Importing Documents from files (spec 27): the shapes of the preview and the
 * job as the app uses them, and the request bodies. The backend decides what
 * an import does; nothing here re-derives its rules.
 */

/** The file types the picker offers: JSON of spec 23, or Markdown. */
export const IMPORT_ACCEPT = ".json,.md,.markdown,.txt,.zip";

/** How often the job is read while it is queued or running. */
export const IMPORT_POLL_INTERVAL_MS = 2000;

/** What the importer chose for a Document that already exists in the Room (spec 27 Decision 5). */
export type ImportResolution = "copy" | "replace";

/** Something the import leaves out or changes in a Document, worded by the client. */
export type ImportWarningCode =
  | "comments_dropped"
  | "files_dropped"
  | "embeds_dropped"
  | "player_dropped"
  | "selective_to_private"
  | "tags_not_created";

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
  /** The match is by name only: the file's id points at nothing in the Room (spec 69). */
  matchedByName: boolean;
  warnings: ImportWarning[];
}

/** Something the import leaves out of a map (spec 40), worded by the client. */
export type ImportMapWarningCode =
  | "documents_left_out"
  | "master_only_dropped"
  | "selective_to_private";

/** Why a map is not created (`invalid`, `limit`) or came without its background (`background`). */
export type ImportMapSkipReason = "invalid" | "limit" | "background";

/** A map found in the uploaded files (spec 40). */
export interface ImportPreviewMap {
  /** Names it in the import request. */
  key: string;
  fileName: string;
  name: string;
  kind: "free" | "geographic";
  /** How many Documents it places once imported. */
  documentsCount: number;
  /** Why it would not be created, or null. */
  skipped: ImportMapSkipReason | null;
  warnings: { code: ImportMapWarningCode; count: number }[];
}

/** Why a Section is not written (`invalid`, `limit`) or came without its image (`image`). */
export type ImportSectionSkipReason = "invalid" | "limit" | "image";

/**
 * A Section of the Room home found in the files (spec 56), listed for the
 * Master only: a custom Section to add, or a page card to apply to the Room's own.
 */
export interface ImportPreviewSection {
  /** Names it in the import request (`sections` or `pageCards` by its kind). */
  key: string;
  fileName: string;
  kind: SectionKind;
  /** Null for a page card keeping its default name (or a custom one without a title). */
  title: string | null;
  hasImage: boolean;
  blocksCount: number;
  /** The Documents blocks left with no Tag the import can resolve. */
  skippedBlocks: number;
  /** Why it would not be written, or null. */
  skipped: Exclude<ImportSectionSkipReason, "image"> | null;
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
  maps: ImportPreviewMap[];
  /** The Sections of the Room home (spec 56); empty unless the importer is the Master. */
  sections: ImportPreviewSection[];
}

/** Why an image was skipped (`SkippedResponse.reason`). */
export type ImportSkipReason =
  | "unreachable"
  | "not_an_image"
  | "too_large"
  | "limit"
  | "storage"
  | "failed";

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

/** A map the import did not create, or created without its background. */
export interface ImportSkippedMap {
  name: string;
  reason: ImportMapSkipReason;
}

/** A Section of the Room home the import created, or a page card it updated. */
export interface ImportedSection {
  id: string;
  kind: SectionKind;
  title: string | null;
}

/** A Section the import did not write, or wrote without its image. */
export interface ImportSkippedSection {
  kind: SectionKind;
  title: string | null;
  reason: ImportSectionSkipReason;
}

/** What a finished import did. */
export interface ImportResult {
  created: ImportedDocument[];
  replaced: ImportedDocument[];
  skipped: ImportSkipped[];
  /** The maps it created (spec 40). */
  maps: ImportedDocument[];
  skippedMaps: ImportSkippedMap[];
  /** The Sections of the Room home it wrote (spec 56). */
  sections: ImportedSection[];
  skippedSections: ImportSkippedSection[];
  /** How many images the files brought and how many were stored (spec 59); null for older jobs. */
  images: ImportImageCount | null;
}

/**
 * Images of an import (spec 59): `total` in its work list, `stored` so far or
 * in the end, `done` (stored or skipped) while it runs.
 */
export interface ImportImageCount {
  total: number;
  stored: number;
  done: number;
}

/** The most images the Documents ticked in one import may bring (spec 59 Decision 1). */
export const MAX_IMPORT_IMAGES = 2000;

/** Where an import job is. */
export type ImportJobStatus = "queued" | "running" | "done" | "failed";

/** An import job as the app uses it. */
export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  createdAt: string;
  finishedAt: string | null;
  result: ImportResult | null;
  /** While its images arrive, once its Documents are written (spec 59). */
  progress: ImportImageCount | null;
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
  matched_by_name: boolean;
  warnings: RawImportWarning[];
}

/** The preview as the API sends it (`ImportPreviewResponse`): converted in `toImportPreview` only. */
export interface RawImportPreview {
  documents: RawImportPreviewDocument[];
  matched_tags: string[];
  tags_to_create: { name: string; category: string | null }[];
  unavailable_tags: string[];
  maps: {
    key: string;
    file_name: string;
    name: string;
    kind: "free" | "geographic";
    documents_count: number;
    skipped: ImportMapSkipReason | null;
    warnings: { code: ImportMapWarningCode; count: number; names: string[] }[];
  }[];
  sections: {
    key: string;
    file_name: string;
    kind: SectionKind;
    title: string | null;
    has_image: boolean;
    blocks_count: number;
    skipped_blocks: number;
    skipped: Exclude<ImportSectionSkipReason, "image"> | null;
  }[];
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
    maps: ImportedDocument[];
    skipped_maps: ImportSkippedMap[];
    sections: ImportedSection[];
    skipped_sections: ImportSkippedSection[];
    images?: ImportImageCount | null;
  } | null;
  progress?: ImportImageCount | null;
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
      matchedByName: document.matched_by_name,
      warnings: document.warnings,
    })),
    matchedTags: raw.matched_tags,
    tagsToCreate: raw.tags_to_create,
    unavailableTags: raw.unavailable_tags,
    maps: raw.maps.map((found) => ({
      key: found.key,
      fileName: found.file_name,
      name: found.name,
      kind: found.kind,
      documentsCount: found.documents_count,
      skipped: found.skipped,
      warnings: found.warnings.map(({ code, count }) => ({ code, count })),
    })),
    sections: raw.sections.map((found) => ({
      key: found.key,
      fileName: found.file_name,
      kind: found.kind,
      title: found.title,
      hasImage: found.has_image,
      blocksCount: found.blocks_count,
      skippedBlocks: found.skipped_blocks,
      skipped: found.skipped,
    })),
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
            maps: raw.result.maps,
            skippedMaps: raw.result.skipped_maps,
            sections: raw.result.sections,
            skippedSections: raw.result.skipped_sections,
            images: raw.result.images ?? null,
          },
    progress: raw.progress ?? null,
  };
}

/**
 * The upload of the preview: the same files the import will send again. A file of
 * a picked folder goes under its path in the folder, which the backend needs to
 * read the folders as Tags (spec 65); `obsidian` forces (true) or switches off
 * (false) reading the Markdown as Obsidian notes, absent lets the backend detect.
 */
export function previewFormData(files: File[], obsidian?: boolean): FormData {
  const body = new FormData();
  files.forEach((file) =>
    body.append("files", file, file.webkitRelativePath || file.name),
  );
  if (obsidian !== undefined) body.append("obsidian", String(obsidian));
  return body;
}

/**
 * What a picked folder sends as a vault (spec 65): its Markdown notes and the
 * pictures they may embed, leaving out Obsidian's own folders and every other
 * file. Nothing at all when the folder holds no note.
 */
export function vaultFiles(files: File[]): File[] {
  const kept = files.filter((file) => {
    const path = file.webkitRelativePath || file.name;
    if (/(^|\/)\.(obsidian|trash)\//i.test(path)) return false;
    return /\.(md|markdown|png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.name);
  });
  return kept.some((file) => /\.(md|markdown)$/i.test(file.name)) ? kept : [];
}

/**
 * The upload of the import: the files again and the choices, as a JSON field —
 * the Documents to import (`selected`), among them the ones to replace
 * (`replace`), the maps to import (`maps`, spec 40), and the custom Sections
 * to add and page cards to apply (`sections`, `page_cards`, spec 56).
 */
export function importFormData(
  files: File[],
  selected: string[],
  replace: string[],
  maps: string[],
  sections: string[],
  pageCards: string[],
  obsidian?: boolean,
): FormData {
  const body = previewFormData(files, obsidian);
  body.append(
    "choices",
    JSON.stringify({
      selected,
      replace,
      maps,
      sections,
      page_cards: pageCards,
    }),
  );
  return body;
}

/** Whether a previewed Section is a page card of the file (ticked into `pageCards`). */
export function isPageCard(
  section: Pick<ImportPreviewSection, "kind">,
): boolean {
  return section.kind !== "custom";
}

/** Whether the job is still going: queued or running. */
export function isActiveImportJob(job: ImportJob | undefined): boolean {
  return job?.status === "queued" || job?.status === "running";
}
