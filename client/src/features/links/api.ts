import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, API_URL, session } from '@/lib/api';
import type { ApiKey, Link, LinkPage, LinkStats, Overview } from '@/lib/types';
import { rangeParams, type RangeKey } from './link-utils';

export const keys = {
  links: (search: string) => ['links', 'list', search] as const,
  allLinks: ['links'] as const,
  link: (id: string) => ['links', 'detail', id] as const,
  stats: (id: string, range: RangeKey) => ['stats', id, range] as const,
  overview: ['overview'] as const,
  apiKeys: ['api-keys'] as const,
};

export function useLinks(search: string) {
  return useInfiniteQuery({
    queryKey: keys.links(search),
    queryFn: ({ pageParam, signal }) =>
      api<LinkPage>('/links', { query: { cursor: pageParam, search, limit: 10 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useLink(id: string) {
  return useQuery({
    queryKey: keys.link(id),
    queryFn: async ({ signal }) => (await api<{ link: Link }>(`/links/${id}`, { signal })).link,
  });
}

export function useOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: ({ signal }) => api<Overview>('/analytics/overview', { signal }),
  });
}

export function useLinkStats(id: string, range: RangeKey) {
  return useQuery({
    queryKey: keys.stats(id, range),
    queryFn: ({ signal }) =>
      api<LinkStats>(`/links/${id}/stats`, { query: rangeParams(range), signal }),
    placeholderData: keepPreviousData,
    // Clicks are written in batches about once a second, so a light poll keeps charts current.
    refetchInterval: 15_000,
  });
}

export interface LinkInput {
  targetUrl: string;
  alias?: string;
  title?: string;
  expiresAt?: string;
  maxClicks?: number;
}

function useInvalidateLinks() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: keys.allLinks });
    void queryClient.invalidateQueries({ queryKey: keys.overview });
  };
}

export function useCreateLink() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (input: LinkInput) =>
      api<{ link: Link }>('/links', { method: 'POST', body: input }).then((r) => r.link),
    onSuccess: invalidate,
  });
}

export function useUpdateLink(id: string) {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (patch: Partial<Omit<LinkInput, 'alias'>> & { isActive?: boolean }) =>
      api<{ link: Link }>(`/links/${id}`, { method: 'PATCH', body: patch }).then((r) => r.link),
    onSuccess: invalidate,
  });
}

export function useDeleteLink() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (id: string) => api(`/links/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

/**
 * The QR endpoint needs the Authorization header, which an <img src> can't
 * send, so the PNG is fetched and exposed as a temporary object URL.
 */
export function useQrCode(id: string, size = 320) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    fetch(`${API_URL}/api/v1/links/${id}/qr?size=${size}`, {
      headers: { Authorization: `Bearer ${session.token ?? ''}` },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('QR code unavailable'))))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, size]);
  return url;
}

export function useApiKeys() {
  return useQuery({
    queryKey: keys.apiKeys,
    queryFn: async ({ signal }) => (await api<{ data: ApiKey[] }>('/api-keys', { signal })).data,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<{ apiKey: ApiKey; secret: string }>('/api-keys', { method: 'POST', body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.apiKeys }),
  });
}
