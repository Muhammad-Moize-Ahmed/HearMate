import { useNavigate, useParams } from 'react-router';

import { ChildForm } from './ChildForm';
import { BackLink, ChildLoadError, Loading } from './common';
import { useChild, useCreateChild, useUpdateChild } from './queries';

export function NewChildPage() {
  const navigate = useNavigate();
  const create = useCreateChild();
  return (
    <div className="mx-auto max-w-2xl">
      <title>Add a child · HearMate</title>
      <BackLink to="/parent">All children</BackLink>
      <h1 className="mb-6 text-3xl font-black">Add a child</h1>
      <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-2 ring-brand-100 sm:p-8">
        <ChildForm
          onSubmit={(body) =>
            create.mutate(body, {
              onSuccess: (child) =>
                void navigate(`/parent/children/${child.id}`, { state: { created: true } }),
            })
          }
          pending={create.isPending}
          error={create.error}
          cancelTo="/parent"
        />
      </div>
    </div>
  );
}

export function EditChildPage() {
  const { childId = '' } = useParams();
  const navigate = useNavigate();
  const child = useChild(childId);
  const update = useUpdateChild(childId);
  const back = `/parent/children/${childId}`;

  if (child.isPending) return <Loading label="Loading profile…" />;
  if (child.isError) return <ChildLoadError error={child.error} />;

  return (
    <div className="mx-auto max-w-2xl">
      <title>{`Edit ${child.data.display_name} · HearMate`}</title>
      <BackLink to={back}>{child.data.display_name}</BackLink>
      <h1 className="mb-6 text-3xl font-black">Edit {child.data.display_name}'s profile</h1>
      <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-2 ring-brand-100 sm:p-8">
        <ChildForm
          child={child.data}
          onSubmit={(body) => update.mutate(body, { onSuccess: () => void navigate(back) })}
          pending={update.isPending}
          error={update.error}
          cancelTo={back}
        />
      </div>
    </div>
  );
}
