import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, describeError } from '../../api/client';
import { usePrincipal } from '../../auth/context';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TextAreaField } from '../../components/ui/fields';
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote, type Note } from './queries';

/** Mirrors the backend (app/modules/notes/schemas.py). */
const noteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(5000, 'Please keep a note under 5,000 characters.'),
});

function noteError(error: Error): string {
  if (error instanceof ApiError && error.code === 'not_note_author') {
    return 'Only the therapist who wrote this note can change it.';
  }
  return describeError(error);
}

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A child's therapist notes. Linked therapists write them and change or delete their own; the
 * parent reads them. The child's own screens never show this section.
 */
export function NotesSection({
  childId,
  childName,
  canWrite,
}: {
  childId: string;
  childName: string;
  canWrite: boolean;
}) {
  const notes = useNotes(childId);
  const create = useCreateNote(childId);
  const [adding, setAdding] = useState(false);

  if (notes.isPending) return <p className="text-ink-soft">Loading notes…</p>;
  // A failed "older notes" page keeps the notes already loaded; only a failed first load ends here.
  if (!notes.data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert tone="error">We couldn't load the notes. {describeError(notes.error!)}</Alert>
        <Button variant="secondary" onClick={() => void notes.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const all = notes.data.pages.flat();

  return (
    <div className="flex flex-col gap-4">
      {canWrite &&
        (adding ? (
          <NoteForm
            submitLabel="Add note"
            pending={create.isPending}
            error={create.error}
            onCancel={() => {
              create.reset();
              setAdding(false);
            }}
            onSubmit={(body) => create.mutate(body, { onSuccess: () => setAdding(false) })}
          />
        ) : (
          <Button className="self-start" onClick={() => setAdding(true)}>
            <span aria-hidden="true">📝</span> Add a note
          </Button>
        ))}

      {all.length === 0 && !adding && (
        <p className="text-ink-soft">
          {canWrite
            ? `No notes yet. Notes are shared with ${childName}'s parent and other therapists on the care team.`
            : `No notes yet. Therapists on ${childName}'s care team can write notes here for you to read.`}
        </p>
      )}

      {all.length > 0 && (
        <ul className="flex flex-col gap-3">
          {all.map((note) => (
            <li key={note.id}>
              <NoteCard note={note} childId={childId} canWrite={canWrite} />
            </li>
          ))}
        </ul>
      )}

      {notes.hasNextPage && (
        <Button
          variant="secondary"
          className="self-start"
          loading={notes.isFetchingNextPage}
          onClick={() => void notes.fetchNextPage()}
        >
          Show older notes
        </Button>
      )}
      {notes.isFetchNextPageError && notes.error && (
        <Alert tone="error">We couldn't load older notes. {describeError(notes.error)}</Alert>
      )}
    </div>
  );
}

function NoteCard({ note, childId, canWrite }: { note: Note; childId: string; canWrite: boolean }) {
  const principal = usePrincipal();
  const update = useUpdateNote(childId);
  const remove = useDeleteNote(childId);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const mine = canWrite && note.author?.id === principal.id;
  // No author: their account was deleted; the note stays with the child.
  const author = note.author
    ? `${note.author.first_name} ${note.author.last_name}`.trim()
    : 'Former therapist';
  const edited = note.updated_at !== note.created_at;

  if (editing) {
    return (
      <NoteForm
        initial={note.body}
        submitLabel="Save note"
        pending={update.isPending}
        error={update.error}
        onCancel={() => {
          update.reset();
          setEditing(false);
        }}
        onSubmit={(body) =>
          body === note.body
            ? setEditing(false)
            : update.mutate({ noteId: note.id, body }, { onSuccess: () => setEditing(false) })
        }
      />
    );
  }

  return (
    <article className="flex flex-col gap-2 rounded-3xl bg-white p-4 ring-2 ring-brand-100">
      <p className="text-sm text-ink-soft">
        <strong className="text-ink">{mine ? 'You' : author}</strong> ·{' '}
        <time dateTime={note.created_at}>{dateTime(note.created_at)}</time>
        {edited && ' · edited'}
      </p>
      <p className="whitespace-pre-line">{note.body}</p>
      {mine && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            aria-label={`Edit note from ${dateTime(note.created_at)}`}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            aria-label={`Delete note from ${dateTime(note.created_at)}`}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </Button>
        </div>
      )}
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this note?"
          confirmLabel="Delete note"
          pending={remove.isPending}
          error={remove.error && <Alert tone="error">{noteError(remove.error)}</Alert>}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => remove.mutate(note.id, { onSuccess: () => setConfirmingDelete(false) })}
        >
          <p>The note will be removed for you, the parent and the rest of the care team.</p>
        </ConfirmDialog>
      )}
    </article>
  );
}

function NoteForm({
  initial = '',
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  pending: boolean;
  error: Error | null;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const form = useForm({ resolver: zodResolver(noteSchema), defaultValues: { body: initial } });
  const submit = form.handleSubmit((values) => onSubmit(values.body));
  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-3xl bg-brand-50 p-4 sm:p-5"
    >
      {error && <Alert tone="error">{noteError(error)}</Alert>}
      <TextAreaField
        label="Note"
        rows={5}
        hint="The parent can read every note."
        error={form.formState.errors.body?.message}
        {...form.register('body')}
      />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
