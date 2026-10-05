import { formatDistanceToNowStrict } from 'date-fns';
import { KeyRound, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/features/links/api';
import { CopyButton } from '@/features/links/DashboardPage';
import { errorMessage } from '@/lib/api';

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

export function ApiKeysPage() {
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [name, setName] = useState('');
  // The API returns the secret exactly once, so it is only ever held in this component.
  const [secret, setSecret] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(name.trim(), {
      onSuccess: (res) => {
        setSecret(res.secret);
        setName('');
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">API keys</h1>
        <p className="mt-1 text-slate-500">
          Use a key in the{' '}
          <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">X-API-Key</code> header to
          create links from scripts and integrations. Keys are stored hashed.
        </p>
      </header>

      <Card>
        <CardContent>
          <form onSubmit={submit} className="flex gap-2">
            <Input
              aria-label="Key name"
              placeholder="What is this key for? e.g. Zapier"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              Create key
            </Button>
          </form>
          {secret && (
            <div className="mt-4 space-y-2">
              <Alert tone="info">Copy this key now. It will not be shown again.</Alert>
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
                <code className="min-w-0 flex-1 text-sm break-all" data-testid="api-key-secret">
                  {secret}
                </code>
                <CopyButton text={secret} label="Copy API key" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {keys.isPending ? (
        <Skeleton className="h-40" />
      ) : keys.isError ? (
        <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
      ) : keys.data.length === 0 ? (
        <EmptyState
          title="No API keys yet"
          description="Create one above to use the API from code."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {keys.data.map((key) => (
              <li key={key.id} className="flex items-center gap-3 px-5 py-3">
                <KeyRound className="size-5 text-slate-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{key.name}</p>
                  <p className="text-sm text-slate-500">
                    <code>{key.prefix}…</code> · created {ago(key.createdAt)} ·{' '}
                    {key.lastUsedAt ? `last used ${ago(key.lastUsedAt)}` : 'never used'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-red-600"
                  aria-label={`Revoke ${key.name}`}
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(key.id, {
                      onSuccess: () => toast.success('Key revoked'),
                      onError: (err) => toast.error(errorMessage(err)),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
