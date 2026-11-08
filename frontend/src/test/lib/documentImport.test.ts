import { describe, expect, it } from 'vitest';
import type { RawImportJob, RawImportPreview } from '../../lib/documentImport';
import {
  importFormData,
  isActiveImportJob,
  isPageCard,
  previewFormData,
  toImportJob,
  toImportPreview,
  vaultNotes,
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
        maps: [
          {
            key: '0:map:0',
            file_name: 'stanza.json',
            name: 'Il Regno',
            kind: 'geographic',
            documents_count: 2,
            skipped: null,
            warnings: [{ code: 'documents_left_out', count: 1, names: [] }],
          },
        ],
        sections: [
          {
            key: '0:section:0',
            file_name: 'stanza.json',
            kind: 'custom',
            title: 'Tokyo',
            has_image: true,
            blocks_count: 2,
            skipped_blocks: 1,
            skipped: null,
          },
        ],
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
    expect(preview.maps).toEqual([
      {
        key: '0:map:0',
        fileName: 'stanza.json',
        name: 'Il Regno',
        kind: 'geographic',
        documentsCount: 2,
        skipped: null,
        warnings: [{ code: 'documents_left_out', count: 1 }],
      },
    ]);
    expect(preview.sections).toEqual([
      {
        key: '0:section:0',
        fileName: 'stanza.json',
        kind: 'custom',
        title: 'Tokyo',
        hasImage: true,
        blocksCount: 2,
        skippedBlocks: 1,
        skipped: null,
      },
    ]);
    expect(isPageCard(preview.sections[0])).toBe(false);
    expect(isPageCard({ kind: 'page_maps' })).toBe(true);
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
      progress: null,
    });
  });

  it('keeps how far the images of a running job got (spec 59)', () => {
    const job = toImportJob(
      rawImportJob({
        status: 'running',
        progress: { total: 450, stored: 118, done: 120 },
      }) as RawImportJob,
    );

    expect(job.progress).toEqual({ total: 450, stored: 118, done: 120 });
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
          maps: [{ id: 'map-1', name: 'Il Regno' }],
          skipped_maps: [{ name: 'La Corte', reason: 'invalid' }],
          sections: [{ id: 'section-1', kind: 'custom', title: 'Tokyo' }],
          skipped_sections: [{ kind: 'page_maps', title: null, reason: 'image' }],
          images: { total: 2, stored: 1, done: 0 },
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
      maps: [{ id: 'map-1', name: 'Il Regno' }],
      skippedMaps: [{ name: 'La Corte', reason: 'invalid' }],
      sections: [{ id: 'section-1', kind: 'custom', title: 'Tokyo' }],
      skippedSections: [{ kind: 'page_maps', title: null, reason: 'image' }],
      images: { total: 2, stored: 1, done: 0 },
    });
  });
});

describe('the uploads', () => {
  const files = [new File(['{}'], 'a.json'), new File(['# A'], 'b.md')];

  it('sends the files under "files" for the preview', () => {
    expect(previewFormData(files).getAll('files')).toHaveLength(2);
  });

  it('sends a picked folder file under its path and the Obsidian choice (spec 65)', () => {
    const note = new File(['x'], 'Jason.md');
    Object.defineProperty(note, 'webkitRelativePath', { value: 'Vault/Characters/Jason.md' });

    const body = previewFormData([note, files[0]], true);

    expect((body.getAll('files')[0] as File).name).toBe('Vault/Characters/Jason.md');
    expect((body.getAll('files')[1] as File).name).toBe('a.json');
    expect(body.get('obsidian')).toBe('true');
    expect(previewFormData(files).has('obsidian')).toBe(false);
    expect(importFormData(files, [], [], [], [], [], false).get('obsidian')).toBe('false');
  });

  it('keeps only the Markdown notes of a folder', () => {
    const picked = [
      new File([''], 'A.md'),
      new File([''], 'pic.PNG'),
      new File([''], 'b.markdown'),
    ];

    expect(vaultNotes(picked).map((f) => f.name)).toEqual(['A.md', 'b.markdown']);
  });

  it('sends the same files and the choices as JSON for the import', () => {
    const body = importFormData(files, ['0:0', '1:0'], ['1:0'], ['0:map:0'], ['0:section:3'], []);

    expect(body.getAll('files')).toHaveLength(2);
    expect(JSON.parse(body.get('choices') as string)).toEqual({
      selected: ['0:0', '1:0'],
      replace: ['1:0'],
      maps: ['0:map:0'],
      sections: ['0:section:3'],
      page_cards: [],
    });
  });
});

describe('isActiveImportJob', () => {
  it('is true while the job is queued or running, false otherwise', () => {
    expect(isActiveImportJob(toImportJob(rawImportJob({ status: 'queued' }) as RawImportJob))).toBe(
      true,
    );
    expect(
      isActiveImportJob(toImportJob(rawImportJob({ status: 'running' }) as RawImportJob)),
    ).toBe(true);
    expect(isActiveImportJob(toImportJob(rawImportJob({ status: 'done' }) as RawImportJob))).toBe(
      false,
    );
    expect(isActiveImportJob(toImportJob(rawImportJob({ status: 'failed' }) as RawImportJob))).toBe(
      false,
    );
    expect(isActiveImportJob(undefined)).toBe(false);
  });
});
