import { createFileRoute } from '@tanstack/react-router';
import { PageHeader, EmptyState } from '@bonakala/bdl';

export const Route = createFileRoute('/booking/')({ component: Page });

function Page() {
  return (
    <div className="page">
      <PageHeader title="Omnichannel inbox" subtitle="This surface is built by its module builder." />
      <EmptyState>Nothing to show yet.</EmptyState>
    </div>
  );
}
