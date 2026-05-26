import type { OrchestratorSession, WorkerTaskSpec } from '../../../../types/app';

interface Props {
  session: OrchestratorSession | null;
  taskSpec: WorkerTaskSpec | null;
}

export default function SessionPanel({ session, taskSpec }: Props) {
  if (!session) {
    return <div className="p-4 text-muted-foreground text-sm">未选中 session</div>;
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <section>
        <h3 className="text-sm font-semibold mb-2">Session Summary</h3>
        <dl className="space-y-1 text-xs">
          <Row label="Title" value={session.title} />
          <Row label="Type" value={session.type} />
          <Row label="Provider" value={session.provider || '-'} />
          <Row label="Model" value={session.model || '-'} />
          <Row label="Lifecycle" value={session.lifecycle_status} />
          <Row label="Run Status" value={session.run_status} />
          <Row label="Interaction" value={session.interaction_mode} />
          <Row label="External ID" value={session.external_session_id || '-'} />
          <Row label="Created" value={session.created_at} />
        </dl>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-1">Goal & Constraints</h3>
        <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{session.goal_and_constraints || '-'}</pre>
      </section>

      {session.last_run_summary && (
        <section>
          <h3 className="text-sm font-semibold mb-1">Last Run</h3>
          <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{session.last_run_summary}</pre>
        </section>
      )}

      {session.last_error_summary && (
        <section>
          <h3 className="text-sm font-semibold mb-1 text-destructive">Last Error</h3>
          <pre className="text-xs bg-destructive/10 p-2 rounded whitespace-pre-wrap">{session.last_error_summary}</pre>
        </section>
      )}

      {taskSpec && (
        <section>
          <h3 className="text-sm font-semibold mb-1">Task Spec</h3>
          <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">
            {JSON.stringify(taskSpec, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
