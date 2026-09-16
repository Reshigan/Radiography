import { createFileRoute } from '@tanstack/react-router';
import { PageHeader, EmptyState } from '@bonakala/bdl';

export const Route = createFileRoute('/bci/')({ component: Page });

function Page() {
  return (
    <div className="page">
      <PageHeader title="Bonakala Clinical Intelligence" subtitle="This surface is built by its module builder." />
      <EmptyState>Nothing to show yet.</EmptyState>
    </div>
  );
}
