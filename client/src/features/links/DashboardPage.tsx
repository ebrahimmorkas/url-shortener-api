import { zodResolver } from '@hookform/resolvers/zod';
import { BarChart3, Check, ChevronDown, Copy, Search } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { errorMessage } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounce';
import { useCreateLink, useLinks, useOverview } from './api';
import { compactNumber, linkState, prettyUrl, STATE_LABEL, STATE_TONE } from './link-utils';

export function DashboardPage() {
  return (
    <div className="space-y-8">
      <CreateLinkCard />
      <OverviewTiles />
      <LinksTable />
    </div>
  );
}

// Mirrors the API's createBody; empty optional fields are dropped before sending.
const schema = z.object({
  targetUrl: z.url({
    protocol: /^https?$/,
    error: 'Enter a full URL starting with http:// or https://',
  }),
  alias: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{3,32}$/, '3–32 characters: letters, digits, "-" or "_"')
    .or(z.literal('')),
  title: z.string().trim().max(200),
  expiresAt: z.string().refine((v) => !v || new Date(v) > new Date(), 'Must be in the future'),
  maxClicks: z.string().regex(/^\d*$/, 'Whole number'),
});
type FormValues = z.infer<typeof schema>;

function CreateLinkCard() {
  const createLink = useCreateLink();
  const [showOptions, setShowOptions] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { targetUrl: '', alias: '', title: '', expiresAt: '', maxClicks: '' },
  });

  const onSubmit = (values: FormValues) =>
    createLink.mutate(
      {
        targetUrl: values.targetUrl,
        alias: values.alias || undefined,
        title: values.title || undefined,
        expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : undefined,
        maxClicks: values.maxClicks ? Number(values.maxClicks) : undefined,
      },
      {
        onSuccess: (link) => {
          reset();
          void navigator.clipboard?.writeText(link.shortUrl).catch(() => {});
          toast.success(`Short link created and copied: ${link.shortUrl}`);
        },
      },
    );

  return (
    <Card>
      <CardContent>
        <h1 className="text-2xl font-bold tracking-tight">Shorten a link</h1>
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Field label="Destination URL" error={errors.targetUrl?.message} className="flex-1">
              <Input
                type="url"
                placeholder="https://example.com/a/very/long/link"
                {...register('targetUrl')}
              />
            </Field>
            <Button type="submit" className="sm:mt-7" loading={createLink.isPending}>
              Shorten
            </Button>
          </div>
          <button
            type="button"
            aria-expanded={showOptions}
            onClick={() => setShowOptions((s) => !s)}
            className="flex items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-200"
          >
            <ChevronDown
              className={`size-4 transition-transform ${showOptions ? 'rotate-180' : ''}`}
              aria-hidden
            />
            Custom alias, expiry and click limit
          </button>
          {showOptions && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Custom alias" error={errors.alias?.message} hint="e.g. spring-sale">
                <Input {...register('alias')} />
              </Field>
              <Field label="Title" error={errors.title?.message}>
                <Input {...register('title')} />
              </Field>
              <Field label="Expires" error={errors.expiresAt?.message}>
                <Input type="datetime-local" {...register('expiresAt')} />
              </Field>
              <Field
                label="Click limit"
                error={errors.maxClicks?.message}
                hint="Stops redirecting after this many clicks"
              >
                <Input inputMode="numeric" {...register('maxClicks')} />
              </Field>
            </div>
          )}
          {createLink.isError && <Alert>{errorMessage(createLink.error)}</Alert>}
        </form>
      </CardContent>
    </Card>
  );
}

function OverviewTiles() {
  const { data, isPending } = useOverview();
  const tiles = [
    { label: 'Links', value: data?.totals.links },
    { label: 'Clicks, last 30 days', value: data?.totals.clicks },
    { label: 'Unique visitors, last 30 days', value: data?.totals.uniqueVisitors },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {tiles.map((tile) => (
        <Card key={tile.label}>
          <CardContent>
            <dt className="text-sm text-slate-500">{tile.label}</dt>
            <dd className="mt-1 text-3xl font-bold tabular-nums">
              {isPending || tile.value === undefined ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <span title={tile.value.toLocaleString()}>{compactNumber(tile.value)}</span>
              )}
            </dd>
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
    </Button>
  );
}

function LinksTable() {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 300);
  const query = useLinks(term);
  const links = query.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <section aria-labelledby="links-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="links-heading" className="text-xl font-semibold">
          Your links
        </h2>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            aria-label="Search links"
            placeholder="Search links"
            className="w-56 pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {query.isPending ? (
        <Skeleton className="h-64" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : links.length === 0 ? (
        <EmptyState
          title={term ? 'No links match your search' : 'No links yet'}
          description={term ? undefined : 'Paste a URL above to create your first short link.'}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Your short links</caption>
              <thead className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Short link</th>
                  <th className="px-4 py-3 font-medium">Destination</th>
                  <th className="px-4 py-3 text-right font-medium">Clicks</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {links.map((link) => {
                  const state = linkState(link);
                  return (
                    <tr key={link.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <RouterLink
                            to={`/links/${link.id}`}
                            className="font-medium text-brand-700 hover:underline dark:text-brand-200"
                          >
                            {prettyUrl(link.shortUrl)}
                          </RouterLink>
                          <CopyButton text={link.shortUrl} label={`Copy ${link.shortUrl}`} />
                        </div>
                        {link.title && <p className="text-slate-500">{link.title}</p>}
                      </td>
                      <td
                        className="max-w-64 truncate px-4 py-3 text-slate-600 dark:text-slate-400"
                        title={link.targetUrl}
                      >
                        {prettyUrl(link.targetUrl)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {link.clickCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RouterLink
                          to={`/links/${link.id}`}
                          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                        >
                          <BarChart3 aria-hidden /> Stats
                        </RouterLink>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {query.hasNextPage && (
            <div className="text-center">
              <Button
                variant="secondary"
                loading={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
