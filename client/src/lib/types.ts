// Shapes returned by the URL Shortener API (see /docs for the OpenAPI document).

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Link {
  id: string;
  code: string;
  shortUrl: string;
  targetUrl: string;
  title: string | null;
  expiresAt: string | null;
  maxClicks: number | null;
  clickCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkPage {
  data: Link[];
  nextCursor: string | null;
}

export interface Breakdown {
  value: string;
  clicks: number;
}

export interface LinkStats {
  link: { id: string; code: string; totalClicks: number };
  range: { from: string; to: string; interval: 'hour' | 'day' };
  totals: { clicks: number; uniqueVisitors: number };
  timeseries: { bucket: string; clicks: number; uniqueVisitors: number }[];
  referrers: Breakdown[];
  browsers: Breakdown[];
  os: Breakdown[];
  devices: Breakdown[];
  countries: Breakdown[];
}

export interface Overview {
  totals: { links: number; clicks: number; uniqueVisitors: number };
  topLinks: { id: string; code: string; title: string | null; clicks: number }[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}
