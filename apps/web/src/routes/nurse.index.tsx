import { createFileRoute } from '@tanstack/react-router';
import { PageHeader, EmptyState } from '@bonakala/bdl';

export const Route = createFileRoute('/nurse/')({ component: Page });

function Page() {
  return (
    <div className="page">
      <PageHeader title="Patients today" subtitle="This surface is built by its module builder." />
      <EmptyState>Nothing to show yet.</EmptyState>
    </div>
  );
}
