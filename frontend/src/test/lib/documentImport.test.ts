import { describe, expect, it } from 'vitest';
import type { RawImportJob, RawImportPreview } from '../../lib/documentImport';
import {
  importFormData,
  isActiveImportJob,
  previewFormData,
  toImportJob,
  toImportPreview,
} from '../../lib/documentImport';
import { rawImportJob, rawImportPreview, rawImportPreviewDocument } from '../fixtures';

describe('toImportPreview', () => {
  it('maps the Documents found, the Tags matched and the ones to create (spec 27)', () => {
    const preview = toImportPreview(
      rawImportPreview({
        documents: [
          rawImportPreviewDocument({
            existing_document_id: 'doc-9',
            can_replace: true,
            warnings: [{ code: 'comments_dropped', count: 3, names: [] }],
          }),
        ],
        tags_to_create: [{ name: 'Fazione', category: 'Gruppo' }],
        unavailable_tags: ['Boss'],
      }) as RawImportPreview,
    );

    expect(preview.documents[0]).toEqual({
      key: '0:0',
      fileName: 'stanza.json',
      name: 'Il Cancello',
      notesCount: 2,
      imagesCount: 1,
      tagNames: ['PNG'],
      existingDocumentId: 'doc-9',
      canReplace: true,
      warnings: [{ code: 'comments_dropped', count: 3, names: [] }],
    });
    expect(preview.matchedTags).toEqual(['PNG']);
    expect(preview.tagsToCreate).toEqual([{ name: 'Fazione', category: 'Gruppo' }]);
    expect(preview.unavailableTags).toEqual(['Boss']);
  });
});

describe('toImportJob', () => {
  it('keeps a job with no result yet', () => {
    expect(toImportJob(rawImportJob() as RawImportJob)).toEqual({
      id: 'import-1',
      status: 'queued',
      createdAt: '2026-10-08T12:00:00Z',
      finishedAt: null,
      result: null,
    });
  });

  it('maps what a finished job did, the skipped images included', () => {
    const job = toImportJob(
      rawImportJob({
        status: 'done',
        finished_at: '2026-10-08T12:01:00Z',
        result: {
          created: [{ id: 'doc-1', name: 'Il Cancello' }],
          replaced: [{ id: 'doc-2', name: 'La Cripta' }],
          skipped: [
            {
              kind: 'image',
              document_id: 'doc-1',
              document_name: 'Il Cancello',
              url: 'https://x.test/a.png',
              reason: 'unreachable',
            },
          ],
        },
      }) as RawImportJob,
    );

    expect(job.result).toEqual({
      created: [{ id: 'doc-1', name: 'Il Cancello' }],
      replaced: [{ id: 'doc-2', name: 'La Cripta' }],
      skipped: [
        {
          documentId: 'doc-1',
          documentName: 'Il Cancello',
          url: 'https://x.test/a.png',
          reason: 'unreachable',
        },
      ],
    });
  });
});

describe('the uploads', () => {
  const files = [new File(['{}'], 'a.json'), new File(['# A'], 'b.md')];

  it('sends the files under "files" for the preview', () => {
    expect(previewFormData(files).getAll('files')).toHaveLength(2);
  });

  it('sends the same files and the choices as JSON for the import', () => {
    const body = importFormData(files, ['0:0', '1:0'], ['1:0']);

    expect(body.getAll('files')).toHaveLength(2);
    expect(JSON.parse(body.get('choices') as string)).toEqual({
      selected: ['0:0', '1:0'],
      replace: ['1:0'],
    });
  });
});

describe('isActiveImportJob', () => {
  it('is true while the job is queued or running, false otherwise', () => {
    expect(isActiveImportJob(toImportJob(rawImportJob({ status: 'queued' }) as RawImportJob))).toBe(true);
    expect(isActiveImportJob(toImportJob(rawImportJob({ status: 'running' }) as RawImportJob))).toBe(true);
    expect(isActiveImportJob(toImportJob(rawImportJob({ status: 'done' }) as RawImportJob))).toBe(false);
    expect(isActiveImportJob(toImportJob(rawImportJob({ status: 'failed' }) as RawImportJob))).toBe(false);
    expect(isActiveImportJob(undefined)).toBe(false);
  });
});
