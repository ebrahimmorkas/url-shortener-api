import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, Skeleton, Spinner } from '@/components/ui/feedback';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import type { Breakdown, Link, LinkStats } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDeleteLink, useLink, useLinkStats, useQrCode, useUpdateLink } from './api';
import { CopyButton } from './DashboardPage';
import {
  chartPoints,
  linkState,
  RANGES,
  STATE_LABEL,
  STATE_TONE,
  withShare,
  type RangeKey,
} from './link-utils';

// Two categorical series, checked for colour-blind separation and contrast in both themes.
const SERIES = {
  light: { Clicks: '#2a78d6', 'Unique visitors': '#eb6834', grid: '#e2e8f0', text: '#64748b' },
  dark: { Clicks: '#3987e5', 'Unique visitors': '#d95926', grid: '#1e293b', text: '#94a3b8' },
};

export function LinkPage() {
  const { id = '' } = useParams();
  const { data: link, isPending, isError, error, refetch } = useLink(id);
  const [range, setRange] = useState<RangeKey>('7d');
  const stats = useLinkStats(id, range);

  if (isPending) return <Spinner />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  const state = linkState(link);
  return (
    <div className="space-y-6">
      <RouterLink
        to="/"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
      >
        <ArrowLeft className="size-4" aria-hidden /> All links
      </RouterLink>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold">{link.title ?? link.code}</h1>
            <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
          </div>
          <p className="mt-1 flex items-center gap-1 font-medium text-brand-700 dark:text-brand-200">
            {link.shortUrl}
            <CopyButton text={link.shortUrl} label="Copy short link" />
          </p>
          <a
            href={link.targetUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 truncate text-sm text-slate-500 hover:underline"
          >
            <ExternalLink className="size-3.5 shrink-0" aria-hidden /> {link.targetUrl}
          </a>
        </div>
        <LinkActions link={link} />
      </header>

      <div
        role="group"
        aria-label="Time range"
        className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900"
      >
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={range === r.key}
            onClick={() => setRange(r.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              range === r.key
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {stats.isPending ? (
        <Skeleton className="h-96" />
      ) : stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
      ) : (
        <div
          className={cn('space-y-6 transition-opacity', stats.isPlaceholderData && 'opacity-60')}
        >
          <dl className="grid gap-4 sm:grid-cols-3">
            <Tile label="Clicks in range" value={stats.data.totals.clicks} />
            <Tile label="Unique visitors in range" value={stats.data.totals.uniqueVisitors} />
            <Tile label="All-time clicks" value={stats.data.link.totalClicks} />
          </dl>
          <Timeline stats={stats.data} />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <BreakdownCard title="Referrers" rows={stats.data.referrers} />
            <BreakdownCard title="Countries" rows={stats.data.countries} />
            <BreakdownCard title="Devices" rows={stats.data.devices} />
            <BreakdownCard title="Browsers" rows={stats.data.browsers} />
            <BreakdownCard title="Operating systems" rows={stats.data.os} />
            <QrCard link={link} />
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent>
        <dt className="text-sm text-slate-500">{label}</dt>
        <dd className="mt-1 text-3xl font-bold tabular-nums">{value.toLocaleString()}</dd>
      </CardContent>
    </Card>
  );
}

function Timeline({ stats }: { stats: LinkStats }) {
  const { theme } = useTheme();
  const colors = SERIES[theme];
  const points = chartPoints(stats);
  const unit = stats.range.interval === 'hour' ? 'hour' : 'day';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clicks per {unit}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="h-72"
          role="img"
          aria-label={`Line chart of clicks and unique visitors per ${unit}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ left: -12, right: 8, top: 4 }}>
              <CartesianGrid vertical={false} stroke={colors.grid} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                fontSize={12}
                stroke={colors.text}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                fontSize={12}
                stroke={colors.text}
              />
              <Tooltip
                cursor={{ stroke: colors.text, strokeDasharray: '3 3' }}
                contentStyle={{
                  borderRadius: 8,
                  border: `1px solid ${colors.grid}`,
                  background: theme === 'dark' ? '#0f172a' : '#ffffff',
                  fontSize: 13,
                }}
                labelStyle={{ color: colors.text }}
                itemStyle={{ color: theme === 'dark' ? '#f1f5f9' : '#0f172a' }}
              />
              <Legend
                iconType="plainline"
                wrapperStyle={{ fontSize: 13 }}
                formatter={(value) => <span style={{ color: colors.text }}>{value}</span>}
              />
              <Line
                type="monotone"
                dataKey="Clicks"
                stroke={colors.Clicks}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="Unique visitors"
                stroke={colors['Unique visitors']}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-slate-500">Show data as a table</summary>
          <div className="mt-2 max-h-64 overflow-y-auto">
            <table className="w-full">
              <caption className="sr-only">Clicks and unique visitors per {unit}</caption>
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 font-medium capitalize">{unit}</th>
                  <th className="py-1 text-right font-medium">Clicks</th>
                  <th className="py-1 text-right font-medium">Unique visitors</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1">{p.label}</td>
                    <td className="py-1 text-right tabular-nums">{p.Clicks}</td>
                    <td className="py-1 text-right tabular-nums">{p['Unique visitors']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

/** Ranked list with proportional bars; one hue because it encodes magnitude only. */
function BreakdownCard({ title, rows }: { title: string; rows: Breakdown[] }) {
  const items = withShare(rows);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">No clicks in this range.</p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.value} title={`${item.value}: ${item.clicks.toLocaleString()} clicks`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate">{item.value}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {item.clicks.toLocaleString()} · {Math.round(item.share * 100)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]"
                    style={{ width: `${Math.max(item.share * 100, 1.5)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function QrCard({ link }: { link: Link }) {
  const qr = useQrCode(link.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>QR code</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        {qr ? (
          <img
            src={qr}
            alt={`QR code for ${link.shortUrl}`}
            className="size-40 rounded-lg bg-white p-2"
          />
        ) : (
          <Skeleton className="size-40" />
        )}
        {qr && (
          <a
            href={qr}
            download={`${link.code}-qr.png`}
            className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-200"
          >
            Download PNG
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function LinkActions({ link }: { link: Link }) {
  const navigate = useNavigate();
  const update = useUpdateLink(link.id);
  const remove = useDeleteLink();
  const [confirm, setConfirm] = useState(false);
  const onError = (err: unknown) => toast.error(errorMessage(err));

  return (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        loading={update.isPending}
        onClick={() =>
          update.mutate(
            { isActive: !link.isActive },
            {
              onSuccess: (l) => toast.success(l.isActive ? 'Link enabled' : 'Link disabled'),
              onError,
            },
          )
        }
      >
        {link.isActive ? 'Disable' : 'Enable'}
      </Button>
      <Button variant="ghost" className="text-red-600" onClick={() => setConfirm(true)}>
        <Trash2 aria-hidden /> Delete
      </Button>
      <ConfirmDialog
        open={confirm}
        title="Delete this link?"
        description="The short URL will stop working and its click history will be removed."
        confirmLabel="Delete link"
        loading={remove.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          remove.mutate(link.id, {
            onSuccess: () => {
              toast.success('Link deleted');
              navigate('/');
            },
            onError,
          })
        }
      />
    </div>
  );
}
